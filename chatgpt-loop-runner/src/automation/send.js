const { reconfirmTarget } = require('./target');
const { isOfficialChatGPTPage, isLoggedIn } = require('./chatgptGuard');
const { findComposer, getComposerText, isComposerEmpty, setComposerText, findSendButton } = require('./composer');
const { countMessages, getLatestByRole } = require('./domSignals');
const logger = require('../logger');

// 同一プロセス内での連打防止(sendOnceの多重呼び出しガード)。
let sendInFlight = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 対象チャットへ send_text を「1回だけ」送信する。
 * dryRun=true のときはDOMへ一切入力・送信操作をしない。
 * 戻り値の status:
 *   'dry_run'  ... DRY RUNのため送信予定を確認しただけ
 *   'sent'     ... 送信が会話へ反映されたことまで確認できた
 *   'unknown'  ... 送信操作はしたが成功確認ができなかった(自動再送しないこと)
 *   'blocked'  ... 安全条件を満たさず送信しなかった(reasonに理由)
 */
async function sendOnce({ context, handle, sendText, dryRun }) {
  if (sendInFlight) {
    return { status: 'blocked', reason: 'send_in_progress', detail: '前の送信処理がまだ完了していません' };
  }
  sendInFlight = true;
  try {
    if (!sendText || sendText.length === 0) {
      return { status: 'blocked', reason: 'empty_send_text', detail: '送る文字が空です' };
    }

    const target1 = await reconfirmTarget(context, handle);
    if (!target1.ok) return { status: 'blocked', reason: target1.reason, detail: target1.detail };
    const page = target1.page;

    if (!(await isOfficialChatGPTPage(page))) {
      return { status: 'blocked', reason: 'not_official_chatgpt', detail: '公式ChatGPTページであることを確認できません' };
    }
    if (!(await isLoggedIn(page))) {
      return { status: 'blocked', reason: 'login_required', detail: 'ログインが確認できません' };
    }

    const composer = await findComposer(page);
    if (!composer) {
      return { status: 'blocked', reason: 'composer_not_found', detail: 'ChatGPTの入力欄を確認できませんでした' };
    }

    if (dryRun) {
      logger.info('DRY RUN: 送信予定を確認しました', { target: handle.info.normalizedUrl, sendText });
      return { status: 'dry_run', sent_at: null };
    }

    // 既にユーザーが未送信の文章を書いている場合は消さずに停止する。
    if (!(await isComposerEmpty(composer))) {
      const existing = await getComposerText(composer);
      return {
        status: 'blocked',
        reason: 'composer_has_existing_text',
        detail: `入力欄に未送信の文章があります: ${existing.slice(0, 50)}`,
      };
    }

    const before = await countMessages(page);

    await setComposerText(composer, sendText);
    const filled = await getComposerText(composer);
    if (filled.trim() !== sendText.trim()) {
      return {
        status: 'blocked',
        reason: 'composer_mismatch_after_fill',
        detail: '入力欄の内容が送信予定の文字と一致しません',
      };
    }

    // 送信直前の再確認(対象タブが変わっていないか)。
    const target2 = await reconfirmTarget(context, handle);
    if (!target2.ok) {
      return { status: 'blocked', reason: target2.reason, detail: target2.detail };
    }

    const sendButton = await findSendButton(page);
    const sentAt = new Date().toISOString();
    if (sendButton && (await sendButton.isEnabled().catch(() => false))) {
      await sendButton.click();
    } else {
      await composer.press('Enter');
    }

    // 送信成功確認: 入力欄が空になり、ユーザーメッセージが1件増え、その内容が一致するか。
    let confirmed = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(500);
      const after = await countMessages(page);
      const composerEmptyNow = await isComposerEmpty(composer).catch(() => false);
      if (after.user === before.user + 1 && composerEmptyNow) {
        const latestUserText = await getLatestByRole(page, 'user');
        if (latestUserText && latestUserText.trim() === sendText.trim()) {
          confirmed = true;
          break;
        }
      }
    }

    if (confirmed) {
      return { status: 'sent', sent_at: sentAt, before_user_count: before.user, before_assistant_count: before.assistant };
    }
    logger.warn('送信成功を確認できませんでした(unknown状態)', { target: handle.info.normalizedUrl });
    return {
      status: 'unknown',
      sent_at: sentAt,
      before_user_count: before.user,
      before_assistant_count: before.assistant,
      reason: 'send_confirmation_failed',
      detail: '送信されたか確認できません。二重送信防止のため自動再送しません。',
    };
  } finally {
    sendInFlight = false;
  }
}

module.exports = { sendOnce };
