const { extractConversationId, normalizeChatUrl, isOfficialChatGPTUrl } = require('./chatgptGuard');

// targetInfo: { url, normalizedUrl, conversationId, title } — state/configへ保存できるシリアライズ可能な情報。
function toTargetInfo(tab) {
  return {
    url: tab.url,
    normalizedUrl: tab.normalizedUrl || normalizeChatUrl(tab.url),
    conversationId: tab.conversationId || extractConversationId(tab.url),
    title: tab.title,
  };
}

function matchesTarget(urlStr, targetInfo) {
  if (!isOfficialChatGPTUrl(urlStr)) return false;
  const conv = extractConversationId(urlStr);
  if (targetInfo.conversationId && conv) {
    return conv === targetInfo.conversationId;
  }
  return normalizeChatUrl(urlStr) === targetInfo.normalizedUrl;
}

// targetHandle = { info: targetInfo, page: Page|null } をループ実行中ずっと保持する。
// ユーザーが他のタブを操作しても、このhandleが指すPageオブジェクト以外へは送信しない。
function createTargetHandle(targetInfo, page = null) {
  return { info: targetInfo, page };
}

// 送信前・送信直前・送信直後・回答待機中の各チェックポイントで呼ぶ。
// 一致していれば ok:true, page を返す。一致しなければ理由付きで ok:false。
async function reconfirmTarget(context, handle) {
  if (handle.page && !handle.page.isClosed()) {
    let currentUrl;
    try {
      currentUrl = handle.page.url();
    } catch {
      currentUrl = null;
    }
    if (currentUrl && matchesTarget(currentUrl, handle.info)) {
      return { ok: true, page: handle.page };
    }
    if (currentUrl) {
      return { ok: false, reason: 'target_changed', detail: `対象タブが別の会話(${currentUrl})へ移動しました` };
    }
  }
  // 元のPageが閉じられた/取得できない場合、同じ会話が別タブとして開いていないか探す。
  const pages = context.pages();
  for (const page of pages) {
    let url;
    try {
      url = page.url();
    } catch {
      continue;
    }
    if (matchesTarget(url, handle.info)) {
      handle.page = page;
      return { ok: true, page };
    }
  }
  return { ok: false, reason: 'target_not_found', detail: '対象チャットのタブが見つかりません' };
}

module.exports = { toTargetInfo, matchesTarget, createTargetHandle, reconfirmTarget };
