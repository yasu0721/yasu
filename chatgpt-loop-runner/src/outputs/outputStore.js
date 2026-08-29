const fs = require('fs');
const path = require('path');
const { PATHS } = require('../paths');

function runOutputsDir(runId) {
  return path.join(PATHS.outputs, runId);
}

function iterationFileName(iteration, repeatCount) {
  const width = Math.max(3, String(repeatCount).length);
  return `${String(iteration).padStart(width, '0')}.txt`;
}

function iterationFilePath(runId, iteration, repeatCount) {
  return path.join(runOutputsDir(runId), iterationFileName(iteration, repeatCount));
}

// 同じiterationを再開のたびに上書き保存する(追記事故防止)。
function saveIterationOutput(run, iterationData) {
  const dir = runOutputsDir(run.run_id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = iterationFilePath(run.run_id, iterationData.iteration, run.repeat_count);
  const body = [
    `run_id: ${run.run_id}`,
    `iteration: ${iterationData.iteration} / ${run.repeat_count}`,
    `send_text: ${run.send_text}`,
    `sent_at: ${iterationData.sent_at || ''}`,
    `answer_started_at: ${iterationData.answer_started_at || ''}`,
    `answer_completed_at: ${iterationData.answer_completed_at || ''}`,
    '',
    '--- ChatGPTの回答 ---',
    iterationData.answer_text || '',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, body, 'utf8');
  return path.relative(PATHS.root, filePath);
}

function iterationOutputExists(runId, iteration, repeatCount) {
  return fs.existsSync(iterationFilePath(runId, iteration, repeatCount));
}

function readIterationOutput(runId, iteration, repeatCount) {
  const p = iterationFilePath(runId, iteration, repeatCount);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

// 壊れて/消えても、各iterationファイルから毎回全体を作り直せるようにする(事故防止)。
function rebuildAllResponses(run) {
  const dir = runOutputsDir(run.run_id);
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  for (const it of [...run.iterations].sort((a, b) => a.iteration - b.iteration)) {
    if (it.status !== 'saved') continue;
    const content = readIterationOutput(run.run_id, it.iteration, run.repeat_count);
    if (content == null) continue;
    const answer = content.split('--- ChatGPTの回答 ---\n')[1] || '';
    parts.push(`=== ${it.iteration} / ${run.repeat_count} ===\n送信：${run.send_text}\n\nChatGPT：\n${answer.trim()}\n`);
  }
  const allPath = path.join(dir, 'all_responses.txt');
  fs.writeFileSync(allPath, parts.join('\n'), 'utf8');
  return path.relative(PATHS.root, allPath);
}

module.exports = {
  runOutputsDir,
  saveIterationOutput,
  iterationOutputExists,
  readIterationOutput,
  rebuildAllResponses,
};
