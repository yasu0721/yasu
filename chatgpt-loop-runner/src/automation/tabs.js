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

module.exports = { listChatGPTTabs };
