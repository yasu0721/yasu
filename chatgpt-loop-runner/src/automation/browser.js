const { chromium } = require('playwright');
const { PATHS, ensureDirs } = require('../paths');
const { isOfficialChatGPTUrl } = require('./chatgptGuard');

let sharedContext = null;
let sharedBrowser = null; // 「いつものChrome」に繋いだ場合のみ使う(切断はするが絶対に閉じない)
let ownsBrowser = true; // true: このツールが起動した専用ブラウザ(終了時に閉じてよい) / false: 既存のブラウザに繋いだだけ(閉じてはいけない)

/**
 * ブラウザへの接続を用意する。
 * cdpUrl が指定された場合は「いつものChrome」に接続する(そのブラウザは絶対に閉じない)。
 * 指定が無ければ、このツール専用の永続プロファイルでChromiumを新しく起動する
 * (ログインはユーザー本人がこのウィンドウで手動で行う。パスワードはコードに一切保存しない)。
 */
async function launchBrowserContext({ headless = false, cdpUrl = null } = {}) {
  if (sharedContext) return sharedContext;
  ensureDirs();

  if (cdpUrl) {
    try {
      sharedBrowser = await chromium.connectOverCDP(cdpUrl);
    } catch (err) {
      throw new Error(
        `いつものChromeに接続できませんでした(${err.message})。最近のChromeは、外部プログラムが普段使っているブラウザへ接続することをセキュリティ上の理由でブロックする場合があります。うまく繋がらない場合は、詳細設定の接続先を空欄に戻して専用ブラウザをお使いください。`
      );
    }
    const contexts = sharedBrowser.contexts();
    sharedContext = contexts[0] || (await sharedBrowser.newContext());
    ownsBrowser = false;
  } else {
    sharedContext = await chromium.launchPersistentContext(PATHS.browserProfile, {
      headless,
      viewport: null,
      args: ['--start-maximized'],
    });
    ownsBrowser = true;
  }

  await ensureChatGPTPageOpen(sharedContext);
  return sharedContext;
}

// 真っ白な画面だけが表示され、ChatGPTを開き忘れて詰まってしまうのを防ぐため、
// ChatGPTのタブが1つもない場合は自動でchatgpt.comを開いておく。
// (いつものChromeに繋いだ場合、既に他のタブが色々開いていることが前提なので、
//  そちらでは新しいタブを勝手には開かない = 何もしない)
async function ensureChatGPTPageOpen(context) {
  if (!ownsBrowser) return;
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

// 専用ブラウザ(このツールが起動したもの)は完全に終了する。
// 「いつものChrome」に繋いだだけの場合は、絶対にユーザーの他のタブを巻き込んで
// 閉じたりしないよう、接続を切るだけにする(Playwrightの仕様上、connectOverCDPで
// 得たBrowserのclose()は接続を切るだけで、外部で起動されたブラウザ本体は終了しない)。
async function closeBrowserContext() {
  if (ownsBrowser && sharedContext) {
    await sharedContext.close();
  } else if (!ownsBrowser && sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
  }
  sharedContext = null;
  sharedBrowser = null;
  ownsBrowser = true;
}

module.exports = { launchBrowserContext, getContext, closeBrowserContext, ensureChatGPTPageOpen };
