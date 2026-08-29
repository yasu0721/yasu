// ブラウザのタブではなく、専用のデスクトップアプリウィンドウとして起動するためのElectronエントリ。
// 中身(自動化ロジック・GUI画面)はsrc/server, publicのものをそのまま使う。
const { app, BrowserWindow } = require('electron');
const { startServer } = require('../server/index');

let mainWindow = null;

async function createWindow() {
  // ブラウザを自動で開く必要はない(このウィンドウ自体が画面になる)。
  const { port } = await startServer({ openBrowser: false });

  mainWindow = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 640,
    minHeight: 600,
    title: 'ChatGPT Loop Runner',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // このツールは単一ウィンドウの実行専用アプリなので、閉じたらアプリごと終了する。
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
