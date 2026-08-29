const fs = require('fs');
const path = require('path');
const { callGpt } = require('./call_gpt');
const { writeLog } = require('./logger');

const INPUT_FILE = path.join(__dirname, '..', 'input', 'input.txt');
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');

function makeRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function main() {
  let material;
  try {
    material = fs.readFileSync(INPUT_FILE, 'utf8').trim();
  } catch (err) {
    console.error('input.txt を読み込めませんでした:', err.message);
    writeLog('router', 'エラー', err.message);
    process.exit(1);
  }

  if (material.length === 0) {
    console.log('input.txt に素材がありません。');
    writeLog('router', '入力なし');
    return;
  }

  const runId = makeRunId();
  console.log(`[1/2] 素材を読み込みました(run_id: ${runId})`);

  let result;
  try {
    result = await callGpt('router', material);
  } catch (err) {
    console.error('振り分けGPTの実行に失敗しました:', err.message);
    writeLog('router', '失敗', err.message);
    process.exit(1);
  }

  const runDir = path.join(OUTPUTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const outFile = path.join(runDir, 'router.txt');
  const fileContent =
    `実行日時: ${new Date().toISOString()}\n` +
    `対象GPT: 振り分けGPT (router)\n` +
    `モック応答: ${result.mocked ? 'はい(APIキー未設定)' : 'いいえ'}\n\n` +
    `--- 回答 ---\n${result.text}\n`;
  fs.writeFileSync(outFile, fileContent, 'utf8');

  console.log('[2/2] 振り分けGPTの回答を保存しました');
  console.log(`保存先: ${outFile}`);
  if (result.mocked) {
    console.log('※ ANTHROPIC_API_KEY が未設定のため、これはダミー応答です。');
  }

  writeLog('router', '成功', `run_id=${runId} mocked=${result.mocked}`);
}

main();
