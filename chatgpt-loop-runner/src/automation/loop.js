const stateStore = require('../state/stateStore');
const outputStore = require('../outputs/outputStore');
const logger = require('../logger');
const { createTargetHandle, reconfirmTarget } = require('./target');
const { isLoggedIn } = require('./chatgptGuard');
const { sendOnce } = require('./send');
const { waitForAnswerCompletion } = require('./waitForAnswer');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { RUN_STATUS, ITERATION_STATUS } = stateStore;

// 「未実行から開始」も「途中から再開」も同じループを使う。
// startIterationは stateStore.findResumeInfo() が決めた値をそのまま渡すだけで、
// current_count+1のような雑な計算はここでは行わない。
async function runLoop(runId, { context, startIteration, resumeNote }) {
  let run = stateStore.loadRun(runId);
  if (!run) throw new Error(`runが見つかりません: ${runId}`);
  if (run.status === RUN_STATUS.COMPLETED) {
    throw new Error('このrunは既に完了しています。再開できません。');
  }

  stateStore.acquireLock(run);
  if (resumeNote) {
    run.resume_history.push({ at: new Date().toISOString(), ...resumeNote });
  }
  run.status = RUN_STATUS.RUNNING;
  run.started_at = run.started_at || new Date().toISOString();
  run.stop_requested = false;
  stateStore.saveRun(run);

  const handle = createTargetHandle(run.target_chat);
  const shouldAbortImmediately = () => {
    const fresh = stateStore.loadRun(runId);
    return !!(fresh && fresh.stop_requested && fresh.stop_mode === 'immediate');
  };

  const waitOptions = {
    answer_start_timeout_sec: run.options.answer_start_timeout_sec,
    answer_complete_timeout_sec: run.options.answer_complete_timeout_sec,
    answer_stable_sec: run.options.answer_stable_sec,
    poll_interval_ms: run.options.poll_interval_ms,
    shouldAbortImmediately,
  };

  const fromIteration = startIteration || 1;

  try {
    for (let n = fromIteration; n <= run.repeat_count; n++) {
      run = stateStore.loadRun(runId); // 停止フラグ等の外部更新を毎回反映

      // 安全停止: 次の送信前に必ず確認する。
      if (run.stop_requested) {
        run.status = RUN_STATUS.STOPPED;
        stateStore.saveRun(run);
        logger.info('安全停止しました', { run_id: runId, at_iteration: n });
        return finish(run);
      }

      const targetCheck = await reconfirmTarget(context, handle);
      if (!targetCheck.ok) {
        run.status = RUN_STATUS.PAUSED;
        run.pause_reason = targetCheck.detail || '対象のChatGPTチャットが見つかりません。ChatGPTで対象のチャットを開いてください。';
        stateStore.saveRun(run);
        logger.warn('対象チャットを確認できないため停止しました', { run_id: runId, reason: targetCheck.reason });
        return finish(run);
      }
      if (!(await isLoggedIn(targetCheck.page))) {
        run.status = RUN_STATUS.LOGIN_REQUIRED;
        stateStore.saveRun(run);
        logger.warn('ログインが確認できないため停止しました', { run_id: runId });
        return finish(run);
      }

      stateStore.patchIteration(run, n, { status: ITERATION_STATUS.SENDING });
      stateStore.saveRun(run);

      const sendResult = await sendOnce({ context, handle, sendText: run.send_text, dryRun: run.dry_run });

      if (sendResult.status === 'dry_run') {
        logger.info(`DRY RUN ${n}/${run.repeat_count}: 送信予定 → 回答待機予定(シミュレーション)`, { send_text: run.send_text });
        stateStore.patchIteration(run, n, {
          status: ITERATION_STATUS.SAVED,
          sent_at: new Date().toISOString(),
          answer_started_at: null,
          answer_completed_at: null,
          saved_at: new Date().toISOString(),
          output_file: null,
        });
        run.current_count = n;
        stateStore.saveRun(run);
        await sleep(200); // DRY RUNは実待機不要。体感できる程度の短い間だけ空ける。
        continue;
      }

      if (sendResult.status === 'blocked') {
        stateStore.patchIteration(run, n, { status: ITERATION_STATUS.FAILED, error_reason: sendResult.reason });
        run.status = mapBlockedReasonToRunStatus(sendResult.reason);
        run.pause_reason = sendResult.detail;
        stateStore.saveRun(run);
        logger.warn('送信をブロックしました', { run_id: runId, iteration: n, reason: sendResult.reason });
        return finish(run);
      }

      if (sendResult.status === 'unknown') {
        stateStore.patchIteration(run, n, {
          status: ITERATION_STATUS.UNKNOWN,
          sent_at: sendResult.sent_at,
          error_reason: sendResult.reason,
        });
        run.status = RUN_STATUS.UNKNOWN;
        stateStore.saveRun(run);
        logger.warn('送信結果が不明のため停止しました(自動再送はしません)', { run_id: runId, iteration: n });
        return finish(run);
      }

      // sendResult.status === 'sent'
      // before_assistant_count / expected_user_count は、途中中断からの再開時に
      // 「ChatGPT側で回答が実際に完了しているか」をwaitForAnswerCompletionで
      // 再確認するために必要な情報なので、ここで必ず保存しておく。
      stateStore.patchIteration(run, n, {
        status: ITERATION_STATUS.SENT,
        sent_at: sendResult.sent_at,
        before_assistant_count: sendResult.before_assistant_count,
        expected_user_count: sendResult.before_user_count + 1,
      });
      stateStore.saveRun(run);

      stateStore.patchIteration(run, n, { status: ITERATION_STATUS.ANSWERING });
      stateStore.saveRun(run);

      const waitResult = await waitForAnswerCompletion({
        context,
        handle,
        baselineAssistantCount: sendResult.before_assistant_count,
        expectedUserCount: sendResult.before_user_count + 1,
        options: waitOptions,
      });

      if (waitResult.status === 'answer_completed') {
        const iterationData = {
          iteration: n,
          sent_at: sendResult.sent_at,
          answer_started_at: waitResult.startedAt,
          answer_completed_at: waitResult.completedAt,
          answer_text: waitResult.assistantText,
        };
        const outputFile = outputStore.saveIterationOutput(run, iterationData);
        stateStore.patchIteration(run, n, {
          status: ITERATION_STATUS.SAVED,
          answer_started_at: waitResult.startedAt,
          answer_completed_at: waitResult.completedAt,
          saved_at: new Date().toISOString(),
          output_file: outputFile,
        });
        run.current_count = n;
        outputStore.rebuildAllResponses(run);
        stateStore.saveRun(run);
        logger.info(`${n}/${run.repeat_count} 回答完了・保存しました`, { run_id: runId, output_file: outputFile });
      } else {
        const statusMap = {
          timeout: ITERATION_STATUS.TIMEOUT,
          error: ITERATION_STATUS.ERROR,
          interrupted: ITERATION_STATUS.INTERRUPTED,
          stopped_immediate: ITERATION_STATUS.ANSWERING,
          target_changed: ITERATION_STATUS.ANSWERING,
          target_not_found: ITERATION_STATUS.ANSWERING,
        };
        stateStore.patchIteration(run, n, {
          status: statusMap[waitResult.status] || ITERATION_STATUS.FAILED,
          answer_started_at: waitResult.startedAt || null,
          error_reason: waitResult.detail || waitResult.status,
        });
        run.status = mapWaitFailureToRunStatus(waitResult.status);
        run.pause_reason = waitResult.detail;
        stateStore.saveRun(run);
        logger.warn('回答完了を確認できなかったため停止しました', { run_id: runId, iteration: n, result: waitResult.status });
        return finish(run);
      }

      // 全iteration完了より前に、次の送信前の安全確認へ戻る(between_iterations_delay)。
      if (n < run.repeat_count) {
        const delayMs = (run.options.between_iterations_delay_sec || 0) * 1000;
        if (delayMs > 0) await sleep(delayMs);
      }
    }

    run = stateStore.loadRun(runId);
    run.status = RUN_STATUS.COMPLETED;
    run.finished_at = new Date().toISOString();
    stateStore.saveRun(run);
    logger.info('全ての繰り返しが完了しました', { run_id: runId, repeat_count: run.repeat_count });
    return finish(run);
  } finally {
    const latest = stateStore.loadRun(runId);
    stateStore.releaseLock(latest);
  }
}

function finish(run) {
  return run;
}

function mapBlockedReasonToRunStatus(reason) {
  if (reason === 'login_required') return RUN_STATUS.LOGIN_REQUIRED;
  if (reason === 'target_changed' || reason === 'target_not_found') return RUN_STATUS.PAUSED;
  if (reason === 'composer_has_existing_text') return RUN_STATUS.PAUSED;
  return RUN_STATUS.FAILED;
}

function mapWaitFailureToRunStatus(status) {
  if (status === 'timeout') return RUN_STATUS.TIMEOUT;
  if (status === 'interrupted') return RUN_STATUS.INTERRUPTED;
  if (status === 'target_changed' || status === 'target_not_found') return RUN_STATUS.PAUSED;
  if (status === 'stopped_immediate') return RUN_STATUS.STOPPED;
  return RUN_STATUS.FAILED;
}

module.exports = { runLoop };
