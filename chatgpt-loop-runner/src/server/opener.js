const { spawn } = require('child_process');

// OSごとに既定のブラウザ/エクスプローラーで開く(URLでもフォルダでも使える)。
function openExternally(target) {
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [target], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
    }
    // 開けなくても(例: サーバー環境にブラウザが無い等)アプリ自体は止めない。
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { openExternally };
