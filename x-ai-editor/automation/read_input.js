const fs = require('fs');
const path = require('path');
const { writeLog } = require('./logger');

const INPUT_FILE = path.join(__dirname, '..', 'input', 'input.txt');

function main() {
  let content;
  try {
    content = fs.readFileSync(INPUT_FILE, 'utf8');
  } catch (err) {
    console.error('input.txt を読み込めませんでした:', err.message);
    writeLog('read_input', 'エラー', err.message);
    process.exit(1);
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    console.log('input.txt に素材がありません。');
    writeLog('read_input', '入力なし');
    return;
  }

  const preview = trimmed.slice(0, 80).replace(/\s+/g, ' ');
  console.log('入力素材を受け取りました。');
  console.log(`文字数: ${trimmed.length}`);
  console.log(`プレビュー: ${preview}${trimmed.length > 80 ? '...' : ''}`);

  writeLog('read_input', '成功', `文字数=${trimmed.length}`);
}

main();
