// 技術的なログは logs/ へ、初心者向けの短い進捗メッセージは呼び出し側(GUI/CLI)へ別途渡す。
// Cookie・認証情報・セッション内容は絶対に書き込まない(redactでの二重防御つき)。
const fs = require('fs');
const path = require('path');
const { PATHS, ensureDirs } = require('./paths');

const SECRET_KEY_PATTERN = /cookie|token|authorization|password|secret|session[-_]?id/i;

function redact(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function logFilePath(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return path.join(PATHS.logs, `app-${d}.log`);
}

function write(level, message, meta) {
  ensureDirs();
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(logFilePath(), line, 'utf8');
  } catch (err) {
    // ログ書き込み自体の失敗でアプリを止めない
    // eslint-disable-next-line no-console
    console.error('ログの書き込みに失敗しました', err);
  }
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  redact,
};
