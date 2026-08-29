const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, ensureDirs } = require('../paths');

// run全体の状態。GUIやループエンジンはこの値だけを見て次の挙動を決める。
const RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
  FAILED: 'failed',
  COMPLETED: 'completed',
  INTERRUPTED: 'interrupted',
  LOGIN_REQUIRED: 'login_required',
  NEEDS_REVIEW: 'needs_review',
};

// 1回分の送信〜保存の状態。
const ITERATION_STATUS = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  ANSWERING: 'answering',
  ANSWER_COMPLETED: 'answer_completed',
  SAVED: 'saved',
  UNKNOWN: 'unknown',
  FAILED: 'failed',
  ERROR: 'error',
  INTERRUPTED: 'interrupted',
  TIMEOUT: 'timeout',
};

function generateRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `run_${ts}_${rand}`;
}

function runFilePath(runId) {
  return path.join(PATHS.runsDir, `${runId}.json`);
}

function createRun({ target_chat, send_text, repeat_count, max_repeat_count, dry_run, options }) {
  ensureDirs();
  const now = new Date().toISOString();
  const iterations = [];
  for (let i = 1; i <= repeat_count; i++) {
    iterations.push({
      iteration: i,
      status: ITERATION_STATUS.PENDING,
      sent_at: null,
      answer_started_at: null,
      answer_completed_at: null,
      saved_at: null,
      output_file: null,
      error_reason: null,
      before_assistant_count: null,
      expected_user_count: null,
    });
  }
  const run = {
    run_id: generateRunId(),
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
    target_chat,
    send_text,
    repeat_count,
    max_repeat_count,
    dry_run,
    options: options || {},
    status: RUN_STATUS.PENDING,
    current_count: 0,
    stop_requested: false,
    stop_mode: 'safe', // 'safe' | 'immediate'
    lock: null,
    iterations,
    resume_history: [],
  };
  saveRun(run);
  return run;
}

function loadRun(runId) {
  const p = runFilePath(runId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveRun(run) {
  ensureDirs();
  run.updated_at = new Date().toISOString();
  const tmp = runFilePath(run.run_id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2), 'utf8');
  fs.renameSync(tmp, runFilePath(run.run_id)); // 書き込み中のクラッシュで壊れないよう置換
  return run;
}

function listRuns() {
  ensureDirs();
  const files = fs.readdirSync(PATHS.runsDir).filter((f) => f.endsWith('.json'));
  const runs = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(PATHS.runsDir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
  runs.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return runs;
}

function getIteration(run, n) {
  return run.iterations.find((it) => it.iteration === n) || null;
}

function patchIteration(run, n, patch) {
  const it = getIteration(run, n);
  if (!it) return run;
  Object.assign(it, patch);
  return run;
}

// ロックはプロセス内二重起動(開始ボタン連打)と、異常終了で残った古いロックの区別のために使う。
function isLockStale(lock) {
  if (!lock) return true;
  if (lock.pid === process.pid) return false; // 自分自身のロックは有効
  try {
    process.kill(lock.pid, 0); // 存在確認のみ。例外が飛べば死んでいる。
    return false;
  } catch {
    return true;
  }
}

function acquireLock(run) {
  // 同一プロセスからの再取得(recoverAndContinue→runLoopのように内部で連鎖する場合)は許可する。
  if (run.lock && run.lock.pid !== process.pid && !isLockStale(run.lock)) {
    const err = new Error(
      `このチャットに対する別の実行(run_id: ${run.run_id})が既に進行中の可能性があります。先にそちらを停止してください。`
    );
    err.code = 'RUN_LOCKED';
    throw err;
  }
  run.lock = { pid: process.pid, acquired_at: new Date().toISOString() };
  saveRun(run);
  return run;
}

function releaseLock(run) {
  run.lock = null;
  saveRun(run);
  return run;
}

function requestStop(run, mode = 'safe') {
  run.stop_requested = true;
  run.stop_mode = mode === 'immediate' ? 'immediate' : 'safe';
  saveRun(run);
  return run;
}

// 再開時にどこから始めるべきかを、current_countだけに頼らずiteration履歴から判定する。
function findResumeInfo(run) {
  const sorted = [...run.iterations].sort((a, b) => a.iteration - b.iteration);
  let lastCompleted = 0;
  let blocking = null;
  for (const it of sorted) {
    if (it.status === ITERATION_STATUS.SAVED) {
      lastCompleted = it.iteration;
      continue;
    }
    blocking = it;
    break;
  }
  const nextIteration = lastCompleted + 1;
  return { lastCompletedIteration: lastCompleted, nextIteration, blockingIteration: blocking };
}

module.exports = {
  RUN_STATUS,
  ITERATION_STATUS,
  createRun,
  loadRun,
  saveRun,
  listRuns,
  getIteration,
  patchIteration,
  acquireLock,
  releaseLock,
  isLockStale,
  requestStop,
  findResumeInfo,
  runFilePath,
};
