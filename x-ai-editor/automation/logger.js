const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'history.log');

// logs/history.log へ1行ずつ追記する。パスワード等の秘密情報は絶対に渡さないこと。
function writeLog(taskName, status, detail = '') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${taskName}: ${status}${detail ? ' - ' + detail : ''}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

module.exports = { writeLog };
