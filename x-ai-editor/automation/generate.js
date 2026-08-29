const fs = require('fs');
const path = require('path');
const { callGpt } = require('./call_gpt');
const { parseRouterOutput } = require('./parse_router');
const { writeLog } = require('./logger');

const INPUT_FILE = path.join(__dirname, '..', 'input', 'input.txt');
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const GPTS_CONFIG_FILE = path.join(__dirname, '..', 'config', 'gpts.json');
const MAX_SPECIALISTS = 5;

function makeRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function loadEnabledSpecialistIds() {
  const { gpts } = JSON.parse(fs.readFileSync(GPTS_CONFIG_FILE, 'utf8'));
  return gpts.filter((g) => g.role_type === 'specialist' && g.enabled).map((g) => g.id);
}

function saveOutput(runDir, fileName, header, text) {
  const filePath = path.join(runDir, fileName);
  const content = `${header}\n\n--- 回答 ---\n${text}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

async function main() {
  let material;
  try {
    material = fs.readFileSync(INPUT_FILE, 'utf8').trim();
  } catch (err) {
    console.error('input.txt を読み込めませんでした:', err.message);
    writeLog('generate', 'エラー', err.message);
    process.exit(1);
  }

  if (material.length === 0) {
    console.log('input.txt に素材がありません。');
    writeLog('generate', '入力なし');
    return;
  }

  const runId = makeRunId();
  const runDir = path.join(OUTPUTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`[1/3] 素材を読み込みました(run_id: ${runId})`);

  // --- 振り分けGPT ---
  let routerResult;
  try {
    routerResult = await callGpt('router', material);
  } catch (err) {
    console.error('振り分けGPTの実行に失敗しました:', err.message);
    writeLog('generate', '失敗(router)', err.message);
    process.exit(1);
  }
  saveOutput(
    runDir,
    'router.txt',
    `実行日時: ${new Date().toISOString()}\n対象GPT: 振り分けGPT (router)\nモック応答: ${routerResult.mocked ? 'はい' : 'いいえ'}`,
    routerResult.text
  );
  console.log('[2/3] 振り分けGPTが分析しました');

  // --- 振り分け結果を解析 ---
  const enabledSpecialistIds = loadEnabledSpecialistIds();
  const parsed = parseRouterOutput(routerResult.text, enabledSpecialistIds);
  if (!parsed) {
    console.log('振り分け結果を自動解析できませんでした。安全のため専門GPTへは送信せず停止します。');
    console.log(`router回答の確認先: ${path.join(runDir, 'router.txt')}`);
    writeLog('generate', '停止(router解析失敗)', `run_id=${runId}`);
    return;
  }

  const targetIds = parsed.selectedIds.slice(0, MAX_SPECIALISTS);
  const skippedIds = parsed.selectedIds.slice(MAX_SPECIALISTS);
  const extraInstructionParts = [];
  if (parsed.targetReaction) extraInstructionParts.push(`【狙う反応】\n${parsed.targetReaction}`);
  if (parsed.avoid) extraInstructionParts.push(`【避けるもの】\n${parsed.avoid}`);
  const extraInstruction = extraInstructionParts.join('\n\n');

  console.log(`[3/3] 専門GPT ${targetIds.length}体が分析中です(${targetIds.join(', ')})`);
  if (skippedIds.length > 0) {
    console.log(`※ 上限(${MAX_SPECIALISTS}体)を超えたため見送り: ${skippedIds.join(', ')}`);
    writeLog('generate', '一部見送り(上限超過)', `run_id=${runId} skipped=${skippedIds.join(',')}`);
  }

  const results = { success: [], failed: [] };
  for (const id of targetIds) {
    try {
      const result = await callGpt(id, material, extraInstruction);
      saveOutput(
        runDir,
        `${id}.txt`,
        `実行日時: ${new Date().toISOString()}\n対象GPT: ${result.gptName} (${id})\nモック応答: ${result.mocked ? 'はい' : 'いいえ'}`,
        result.text
      );
      results.success.push(id);
      writeLog('generate', `成功(${id})`, `run_id=${runId}`);
    } catch (err) {
      results.failed.push(id);
      writeLog('generate', `失敗(${id})`, err.message);
      console.log(`${id} の回答取得に失敗しました(処理は続けます)`);
    }
  }

  console.log('完成しました。');
  console.log(`保存先フォルダ: ${runDir}`);
  console.log(`成功: ${results.success.join(', ') || 'なし'}`);
  if (results.failed.length > 0) {
    console.log(`失敗: ${results.failed.join(', ')}`);
  }

  writeLog(
    'generate',
    '完了',
    `run_id=${runId} success=${results.success.join('|')} failed=${results.failed.join('|')}`
  );
}

main();
