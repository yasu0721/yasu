const fs = require('fs');
const { chromium } = require('playwright');
const { writeLog } = require('./logger');

// 開発サンドボックス環境にだけ存在する、事前インストール済みChromiumの実体。
// Playwrightのバージョンとヘッドレス専用ビルドのrevisionがズレて自動検出に
// 失敗する環境向けの回避策。存在しない場合(Windows等)はPlaywright標準の
// 検出方法にそのまま任せる。
const SANDBOX_CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// 自動化専用ブラウザが起動できるかどうかだけを確認するテスト。
// まだChatGPT等の実サイトは操作しない。
async function main() {
  let browser;
  try {
    const launchOptions = { headless: true };
    if (fs.existsSync(SANDBOX_CHROMIUM_PATH)) {
      launchOptions.executablePath = SANDBOX_CHROMIUM_PATH;
    }
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage();
    // 外部ネットワークに依存しない、ブラウザ内で完結するテストページ。
    // 実行環境のネットワーク制限に関係なく、ブラウザ自体の起動・操作を確認できる。
    await page.setContent('<title>x-ai-editor ブラウザテスト</title><h1>OK</h1>');
    const title = await page.title();

    console.log('ブラウザ起動成功');
    console.log(`ページタイトル: ${title}`);

    writeLog('browser_test', '成功', `title=${title}`);
  } catch (err) {
    console.error('ブラウザテストに失敗しました:', err.message);
    writeLog('browser_test', '失敗', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

main();
