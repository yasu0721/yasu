const fs = require('fs');
const { PATHS, ensureDirs } = require('../paths');
const DEFAULTS = require('./defaults');

function loadConfig() {
  ensureDirs();
  let saved = {};
  if (fs.existsSync(PATHS.configFile)) {
    try {
      saved = JSON.parse(fs.readFileSync(PATHS.configFile, 'utf8'));
    } catch (err) {
      // 壊れた設定ファイルはデフォルトへフォールバック(初心者が編集して壊すケースを想定)
      saved = {};
    }
  }
  return { ...DEFAULTS, ...saved };
}

function saveConfig(partial) {
  ensureDirs();
  const current = loadConfig();
  const next = { ...current, ...partial };
  fs.writeFileSync(PATHS.configFile, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// 実行開始直前の安全確認。1つでも問題があれば理由の配列を返す(空配列なら開始可能)。
function validateRunParams(config) {
  const errors = [];

  if (!config.target_chat || !config.target_chat.url) {
    errors.push('対象チャットが選択されていません');
  }

  if (typeof config.send_text !== 'string' || config.send_text.length === 0) {
    errors.push('送る文字が空です');
  }
  if (typeof config.send_text === 'string' && config.send_text.length > 500) {
    errors.push('送る文字が長すぎます(500文字以内にしてください)');
  }

  const repeatCount = Number(config.repeat_count);
  if (!Number.isInteger(repeatCount) || repeatCount <= 0) {
    errors.push('繰り返し回数は1以上の整数にしてください');
  }

  const maxRepeat = Number(config.max_repeat_count);
  if (!Number.isInteger(maxRepeat) || maxRepeat <= 0) {
    errors.push('安全上限(max_repeat_count)の設定が不正です');
  } else if (Number.isInteger(repeatCount) && repeatCount > maxRepeat) {
    errors.push(`繰り返し回数(${repeatCount})が安全上限(${maxRepeat})を超えています`);
  }

  if (typeof config.dry_run !== 'boolean') {
    errors.push('dry_runの設定が不正です');
  }

  for (const key of [
    'answer_start_timeout_sec',
    'answer_complete_timeout_sec',
    'answer_stable_sec',
    'between_iterations_delay_sec',
    'poll_interval_ms',
  ]) {
    const v = Number(config[key]);
    if (!Number.isFinite(v) || v < 0) {
      errors.push(`${key} の設定が不正です`);
    }
  }

  return errors;
}

module.exports = { loadConfig, saveConfig, validateRunParams, DEFAULTS };
