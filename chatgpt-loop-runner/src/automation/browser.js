const { chromium } = require('playwright');
const { PATHS, ensureDirs } = require('../paths');
const { isOfficialChatGPTUrl } = require('./chatgptGuard');

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
  await ensureChatGPTPageOpen(sharedContext);
  return sharedContext;
}

// 専用ブラウザに真っ白な画面だけが表示され、ChatGPTを開き忘れて
// 普段使いのブラウザへ戻ってしまう、という初心者の詰まりを防ぐため、
// ChatGPTのタブが1つもない場合は自動でchatgpt.comを開いておく。
async function ensureChatGPTPageOpen(context) {
  const pages = context.pages();
  const hasChatGPT = pages.some((p) => {
    try {
      return isOfficialChatGPTUrl(p.url());
    } catch {
      return false;
    }
  });
  if (hasChatGPT) return;
  const blank = pages.find((p) => p.url() === 'about:blank');
  const page = blank || (await context.newPage());
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.bringToFront().catch(() => {});
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

module.exports = { launchBrowserContext, getContext, closeBrowserContext, ensureChatGPTPageOpen };
