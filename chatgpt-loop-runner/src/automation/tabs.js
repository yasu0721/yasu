const { isOfficialChatGPTUrl, extractConversationId, normalizeChatUrl } = require('./chatgptGuard');

// 現在開いているタブの中からChatGPTのものだけを一覧化する。
// 「Chromeの3番目のタブ」のような番号だけに依存せず、
// 会話URL(conversationId)を識別子として一緒に保存する。
async function listChatGPTTabs(context) {
  const pages = context.pages();
  const tabs = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let url;
    try {
      url = page.url();
    } catch {
      continue;
    }
    if (!isOfficialChatGPTUrl(url)) continue;
    let title = '';
    try {
      title = await page.title();
    } catch {
      title = '(タイトル取得失敗)';
    }
    tabs.push({
      index: i,
      url,
      normalizedUrl: normalizeChatUrl(url),
      conversationId: extractConversationId(url),
      title: title || '(無題のチャット)',
    });
  }
  return tabs;
}

// 「タブを自分で複数開く」前提ではなく、ChatGPT画面のサイドバーに並んでいる
// 会話一覧(普段のChatGPTの使い方はこちらが主流)から直接選べるようにするための関数。
// タブとして開いていない会話も一覧に出す(選んだ時点でそのタブへ移動させる)。
async function listSidebarConversations(page) {
  let items;
  try {
    items = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href^="/c/"]'));
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const title = (a.innerText || a.textContent || '').trim() || '(無題のチャット)';
        out.push({ url: location.origin + href, title });
      }
      return out;
    });
  } catch {
    return [];
  }
  return items.map((it) => ({
    url: it.url,
    normalizedUrl: normalizeChatUrl(it.url),
    conversationId: extractConversationId(it.url),
    title: it.title,
  }));
}

module.exports = { listChatGPTTabs, listSidebarConversations };
