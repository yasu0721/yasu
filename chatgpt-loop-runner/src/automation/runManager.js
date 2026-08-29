// GUI/CLIから呼ばれる薄いオーケストレーション層。
// 「今どのrunが動いているか」は、プロセス内で自分自身が保持しているlock(pid一致)で判断する。
// これはディスク上のstate(run.json)そのものなので、サーバー再起動をまたいでも正しく判定できる。
const stateStore = require('../state/stateStore');
const outputStore = require('../outputs/outputStore');
const { validateRunParams } = require('../config/configStore');
const { runLoop } = require('./loop');
const { resumeRun, getResumeSummary } = require('./resume');
const logger = require('../logger');

function isAnyRunActive() {
  return stateStore.listRuns().some((r) => r.lock && r.lock.pid === process.pid);
}

function getActiveRun() {
  return stateStore.listRuns().find((r) => r.lock && r.lock.pid === process.pid) || null;
}

function assertNotBusy() {
  if (isAnyRunActive()) {
    const err = new Error('別のrunが実行中です。先に安全に停止してください。');
    err.code = 'BUSY';
    throw err;
  }
}

async function startNewRun(context, config) {
  assertNotBusy();
  const errors = validateRunParams(config);
  if (errors.length > 0) {
    const err = new Error(errors.join(' / '));
    err.code = 'VALIDATION';
    throw err;
  }
  const run = stateStore.createRun({
    target_chat: config.target_chat,
    send_text: config.send_text,
    repeat_count: Number(config.repeat_count),
    max_repeat_count: Number(config.max_repeat_count),
    dry_run: !!config.dry_run,
    options: {
      answer_start_timeout_sec: Number(config.answer_start_timeout_sec),
      answer_complete_timeout_sec: Number(config.answer_complete_timeout_sec),
      answer_stable_sec: Number(config.answer_stable_sec),
      between_iterations_delay_sec: Number(config.between_iterations_delay_sec),
      poll_interval_ms: Number(config.poll_interval_ms),
    },
  });
  // runLoopは長時間かかるためawaitしない。GUIはrun_idでstateをポーリングする。
  runLoop(run.run_id, { context }).catch((err) => {
    logger.error('runLoopが異常終了しました', { run_id: run.run_id, error: err.message });
  });
  return run;
}

function requestStop(runId, mode) {
  const run = stateStore.loadRun(runId);
  if (!run) {
    const err = new Error('runが見つかりません');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return stateStore.requestStop(run, mode);
}

async function resumeRunById(runId, context, opts) {
  assertNotBusy();
  return resumeRun(runId, context, opts);
}

module.exports = {
  isAnyRunActive,
  getActiveRun,
  startNewRun,
  requestStop,
  resumeRunById,
  getResumeSummary,
  listRuns: stateStore.listRuns,
  loadRun: stateStore.loadRun,
  runOutputsDir: outputStore.runOutputsDir,
};
