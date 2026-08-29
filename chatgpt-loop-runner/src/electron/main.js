// ブラウザのタブではなく、専用のデスクトップアプリウィンドウとして起動するためのElectronエントリ。
// 中身(自動化ロジック・GUI画面)はsrc/server, publicのものをそのまま使う。
const { app, BrowserWindow } = require('electron');
const { startServer } = require('../server/index');
const { closeBrowserContext } = require('../automation/browser');

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

app.on('window-all-closed', async () => {
  // 専用ブラウザを残したままアプリだけ終了すると、次回起動時に
  // 同じプロファイルを使おうとして「既に使用中」で失敗する原因になるため、
  // アプリを閉じるときは専用ブラウザも必ず一緒に終了させる。
  await closeBrowserContext().catch(() => {});
  app.quit();
});

app.on('before-quit', async () => {
  await closeBrowserContext().catch(() => {});
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
