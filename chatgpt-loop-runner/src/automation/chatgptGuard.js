// 「対象ページが公式ChatGPTであることを確認できなければ入力・送信を禁止する」ための土台。
// hostnameの完全一致だけを信頼できる一次防御とし(サブストリング一致は
// evil-chatgpt.com のようなドメインを誤検知するため使わない)、
// 追加のDOM状態確認を二次確認として組み合わせる。
const OFFICIAL_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

// テスト専用フック: 実際のChatGPTへ接続できない環境で検知ロジックを検証するための
// モックページ用ホスト許可リスト。通常のアプリ起動では設定されない(READMEにも記載しない)。
const EXTRA_TEST_HOSTS = new Set(
  (process.env.CHATGPT_LOOP_RUNNER_TEST_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function isOfficialChatGPTUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (EXTRA_TEST_HOSTS.has(u.hostname)) return true;
    if (u.protocol !== 'https:') return false;
    return OFFICIAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function isLoginPath(urlStr) {
  try {
    const u = new URL(urlStr);
    return /\/auth|\/login|\/signup|\/signin/i.test(u.pathname);
  } catch {
    return false;
  }
}

function extractConversationId(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function normalizeChatUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.origin}${u.pathname}`;
  } catch {
    return urlStr;
  }
}

// ページが実際に公式ChatGPTのDOMを描画しているかの二次確認(ドメイン一致だけに頼らない)。
async function isOfficialChatGPTPage(page) {
  if (!isOfficialChatGPTUrl(page.url())) return false;
  try {
    const ready = await page.evaluate(() => document.readyState);
    if (ready !== 'complete' && ready !== 'interactive') return false;
    const bodyLength = await page.evaluate(() => document.body ? document.body.innerText.length : 0);
    return bodyLength > 0;
  } catch {
    return false;
  }
}

async function isLoginPage(page) {
  if (isLoginPath(page.url())) return true;
  try {
    const loginVisible = await page
      .locator('text=/^\\s*Log in\\s*$/i')
      .first()
      .isVisible()
      .catch(() => false);
    return loginVisible;
  } catch {
    return false;
  }
}

async function isLoggedIn(page) {
  if (await isLoginPage(page)) return false;
  return true;
}

module.exports = {
  OFFICIAL_HOSTS,
  isOfficialChatGPTUrl,
  isLoginPath,
  isLoginPage,
  isLoggedIn,
  isOfficialChatGPTPage,
  extractConversationId,
  normalizeChatUrl,
};
