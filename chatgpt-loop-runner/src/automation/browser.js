const { chromium } = require('playwright');
const { PATHS, ensureDirs } = require('../paths');

let sharedContext = null;

// このツール専用の永続プロファイルでChromiumを起動する。
// ログインはユーザー本人がこのウィンドウで手動で行う(パスワードはコードに一切保存しない)。
async function launchBrowserContext({ headless = false } = {}) {
  if (sharedContext) return sharedContext;
  ensureDirs();
  sharedContext = await chromium.launchPersistentContext(PATHS.browserProfile, {
    headless,
    viewport: null,
    args: ['--start-maximized'],
  });
  return sharedContext;
}

async function getContext() {
  if (!sharedContext) {
    throw new Error('ブラウザがまだ起動していません。先にlaunchBrowserContext()を呼んでください。');
  }
  return sharedContext;
}

async function closeBrowserContext() {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
  }
}

module.exports = { launchBrowserContext, getContext, closeBrowserContext };
