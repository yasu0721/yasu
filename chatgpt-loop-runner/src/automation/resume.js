const stateStore = require('../state/stateStore');
const outputStore = require('../outputs/outputStore');
const logger = require('../logger');
const { createTargetHandle, reconfirmTarget } = require('./target');
const { isLoggedIn } = require('./chatgptGuard');
const { waitForAnswerCompletion } = require('./waitForAnswer');
const { runLoop } = require('./loop');

const { RUN_STATUS, ITERATION_STATUS } = stateStore;

// runLoopは何分もかかりうるため、resumeRun()の呼び出し元(HTTP API)を長時間ブロックしない。
// 進捗はGUI側がstate(run.json)をポーリングして確認する。
function launchLoopInBackground(runId, opts) {
  runLoop(runId, opts).catch((err) => {
    logger.error('再開後のループが異常終了しました', { run_id: runId, error: err.message });
  });
}

// GUI表示用の軽量サマリー。ブラウザ操作は行わない(ディスク上のstateとoutputsだけを見る)。
function getResumeSummary(runId) {
  const run = stateStore.loadRun(runId);
  if (!run) return { run_id: runId, resumable: false, reason: 'no_such_run' };
  if (run.status === RUN_STATUS.COMPLETED) {
    return { run_id: runId, resumable: false, reason: 'already_completed', repeat_count: run.repeat_count };
  }

  const info = stateStore.findResumeInfo(run);
  const missingOutputs = [];
  for (const it of run.iterations) {
    if (it.status === ITERATION_STATUS.SAVED && !outputStore.iterationOutputExists(run.run_id, it.iteration, run.repeat_count)) {
      missingOutputs.push(it.iteration);
    }
  }

  return {
    run_id: runId,
    target_chat: run.target_chat,
    send_text: run.send_text,
    repeat_count: run.repeat_count,
    lastCompletedIteration: info.lastCompletedIteration,
    nextIteration: info.nextIteration,
    blockingIteration: info.blockingIteration,
    integrityOk: missingOutputs.length === 0,
    missingOutputs,
    resumable: missingOutputs.length === 0,
    needsHumanDecision: !!info.blockingIteration && info.blockingIteration.status === ITERATION_STATUS.UNKNOWN,
  };
}

// unknown状態のiterationに対する人間の判断を反映する。
function applyHumanDecision(run, iterationNumber, decision) {
  if (decision === 'mark_unsent_retry') {
    stateStore.patchIteration(run, iterationNumber, { status: ITERATION_STATUS.PENDING, error_reason: null });
    return { action: 'retry_from' };
  }
  if (decision === 'mark_sent_continue') {
    stateStore.patchIteration(run, iterationNumber, { status: ITERATION_STATUS.ANSWERING, error_reason: null });
    return { action: 'recover_answer' };
  }
  if (decision === 'end_run') {
    run.status = RUN_STATUS.STOPPED;
    stateStore.saveRun(run);
    return { action: 'ended' };
  }
  throw new Error(`不明な決定です: ${decision}`);
}

// sent/answeringで中断していたiterationについて、実際のChatGPT側の状態を確認し、
// 完了していれば回収・保存してから続きのループへつなげる。時間がかかりうるため常に非同期・非ブロッキングで行う。
async function recoverAndContinue(runId, context, handle, iterationNumber) {
  let run = stateStore.loadRun(runId);
  const target = stateStore.getIteration(run, iterationNumber);

  const recoveryProbe = await waitForAnswerCompletion({
    context,
    handle,
    baselineAssistantCount: target.before_assistant_count,
    expectedUserCount: target.expected_user_count,
    options: run.options,
  });

  run = stateStore.loadRun(runId);

  if (recoveryProbe.status === 'answer_completed') {
    const outputFile = outputStore.saveIterationOutput(run, {
      iteration: iterationNumber,
      sent_at: target.sent_at,
      answer_started_at: recoveryProbe.startedAt,
      answer_completed_at: recoveryProbe.completedAt,
      answer_text: recoveryProbe.assistantText,
    });
    stateStore.patchIteration(run, iterationNumber, {
      status: ITERATION_STATUS.SAVED,
      answer_started_at: recoveryProbe.startedAt,
      answer_completed_at: recoveryProbe.completedAt,
      saved_at: new Date().toISOString(),
      output_file: outputFile,
    });
    run.current_count = iterationNumber;
    outputStore.rebuildAllResponses(run);
    stateStore.saveRun(run);
    logger.info('中断していた回答を回収して保存しました', { run_id: runId, iteration: iterationNumber });
    launchLoopInBackground(runId, {
      context,
      startIteration: iterationNumber + 1,
      resumeNote: { reason: 'recovered_and_continue', iteration: iterationNumber },
    });
    return;
  }

  if (recoveryProbe.status === 'timeout' && recoveryProbe.phase === 'start') {
    run.status = RUN_STATUS.UNKNOWN;
    run.pause_reason = `${iterationNumber}回目が送信・回答済みか確認できません。`;
    stateStore.releaseLock(run);
    logger.warn('中断していたiterationの状態を確認できませんでした(人間確認待ち)', { run_id: runId, iteration: iterationNumber });
    return;
  }

  const statusMap = { timeout: ITERATION_STATUS.TIMEOUT, error: ITERATION_STATUS.ERROR, interrupted: ITERATION_STATUS.INTERRUPTED };
  stateStore.patchIteration(run, iterationNumber, {
    status: statusMap[recoveryProbe.status] || ITERATION_STATUS.FAILED,
    error_reason: recoveryProbe.detail || recoveryProbe.status,
  });
  run.status =
    recoveryProbe.status === 'timeout'
      ? RUN_STATUS.TIMEOUT
      : recoveryProbe.status === 'interrupted'
      ? RUN_STATUS.INTERRUPTED
      : RUN_STATUS.PAUSED;
  stateStore.releaseLock(run);
}

/**
 * 安全な再開エンジン。すぐに結果が返せる場合は同期的に返し、
 * 実際にブラウザを長時間待たせる必要がある処理はバックグラウンドへ渡す。
 * 呼び出し元(GUI)はrun_id経由でstate(run.json)をポーリングして進捗を見る。
 *
 * 1) completed runは再開しない
 * 2) 出力ファイルの整合性を確認する(壊れていれば進めない)
 * 3) unknown状態は人間の決定(humanDecision)なしに進めない
 * 4) sent/answeringで中断していた場合は、実際のChatGPT側の状態を確認してから続きへ進む
 */
async function resumeRun(runId, context, { humanDecision } = {}) {
  let run = stateStore.loadRun(runId);
  if (!run) return { status: 'no_such_run' };
  if (run.status === RUN_STATUS.COMPLETED) return { status: 'already_completed' };

  outputStore.rebuildAllResponses(run); // all_responses.txtの再構築は常に安全に行える

  const handle = createTargetHandle(run.target_chat);
  const targetCheck = await reconfirmTarget(context, handle);
  if (!targetCheck.ok) {
    return { status: 'target_not_found', detail: '対象チャットを開いてください' };
  }
  if (!(await isLoggedIn(targetCheck.page))) {
    return { status: 'login_required', detail: 'ChatGPTへログインしてください' };
  }

  const missingOutputs = run.iterations
    .filter((it) => it.status === ITERATION_STATUS.SAVED)
    .filter((it) => !outputStore.iterationOutputExists(run.run_id, it.iteration, run.repeat_count))
    .map((it) => it.iteration);
  if (missingOutputs.length > 0) {
    return { status: 'needs_review', detail: `保存済みのはずの回答ファイルが見つかりません: ${missingOutputs.join(', ')}` };
  }

  const info = stateStore.findResumeInfo(run);
  const blocking = info.blockingIteration;

  if (!blocking || blocking.status === ITERATION_STATUS.PENDING) {
    logger.info('通常再開します', { run_id: runId, from: info.nextIteration });
    launchLoopInBackground(runId, {
      context,
      startIteration: info.nextIteration,
      resumeNote: { reason: 'normal_resume', from_iteration: info.nextIteration },
    });
    return { status: 'resumed', from_iteration: info.nextIteration };
  }

  if (blocking.status === ITERATION_STATUS.UNKNOWN) {
    if (!humanDecision) {
      return {
        status: 'needs_human_decision',
        iteration: blocking.iteration,
        options: ['mark_sent_continue', 'mark_unsent_retry', 'end_run'],
        detail: `${blocking.iteration}回目が送信済みか確認できません。重複送信防止のため自動再開を停止しました。`,
      };
    }
    const decisionResult = applyHumanDecision(run, blocking.iteration, humanDecision);
    stateStore.saveRun(run);
    if (decisionResult.action === 'ended') return { status: 'ended_by_user' };
    if (decisionResult.action === 'retry_from') {
      launchLoopInBackground(runId, {
        context,
        startIteration: blocking.iteration,
        resumeNote: { reason: 'human_marked_unsent_retry', iteration: blocking.iteration },
      });
      return { status: 'resumed', from_iteration: blocking.iteration };
    }
    // 'recover_answer' の場合はこの下のsent/answering回収ロジックへ続ける。
  }

  run = stateStore.loadRun(runId);
  const target = stateStore.getIteration(run, blocking.iteration);
  if (target.before_assistant_count == null || target.expected_user_count == null) {
    return {
      status: 'needs_human_decision',
      iteration: blocking.iteration,
      options: ['mark_unsent_retry', 'end_run'],
      detail: `${blocking.iteration}回目の送信前後の情報が不足しており、自動確認できません。`,
    };
  }

  logger.info('中断したiterationの状態をChatGPT側で確認します', { run_id: runId, iteration: blocking.iteration });
  // 確認処理中も「同時run防止」が効くよう、非同期処理を始める前に同期的にロックを取っておく。
  stateStore.acquireLock(run);
  recoverAndContinue(runId, context, handle, blocking.iteration).catch((err) => {
    logger.error('中断状態の確認処理が異常終了しました', { run_id: runId, error: err.message });
  });
  return { status: 'checking', iteration: blocking.iteration, detail: `${blocking.iteration}回目の状態をChatGPT側で確認しています…` };
}

module.exports = { getResumeSummary, resumeRun };
