const { reconfirmTarget } = require('./target');
const { countMessages, getLatestByRole, isGenerating, hasErrorBanner } = require('./domSignals');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 「回答開始 → 生成中 → 完了」を固定秒数に頼らず判定する共通関数。
 * ループエンジン(STEP4以降)からも同じ関数を呼ぶ。
 *
 * baselineAssistantCount: 送信前のassistantメッセージ数
 * expectedUserCount: 送信後に期待されるuserメッセージ数(送信前+1)
 *
 * 戻り値 status:
 *   'answer_completed' | 'timeout' | 'error' | 'interrupted' | 'target_changed' | 'target_not_found'
 */
async function waitForAnswerCompletion({ context, handle, baselineAssistantCount, expectedUserCount, options }) {
  const {
    answer_start_timeout_sec = 60,
    answer_complete_timeout_sec = 600,
    answer_stable_sec = 3,
    poll_interval_ms = 800,
    shouldAbortImmediately = null, // () => boolean。「即時停止」用のフック。安全停止では使わない。
  } = options || {};

  const startDeadline = Date.now() + answer_start_timeout_sec * 1000;

  // --- フェーズ1: 回答開始待ち ---
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (shouldAbortImmediately && shouldAbortImmediately()) {
      return { status: 'stopped_immediate', detail: '即時停止が要求されました' };
    }
    const t = await reconfirmTarget(context, handle);
    if (!t.ok) return { status: t.reason, detail: t.detail };
    const page = t.page;

    const counts = await countMessages(page);
    if (counts.user > expectedUserCount) {
      return { status: 'interrupted', detail: '想定外のユーザーメッセージを検知しました' };
    }
    if (counts.assistant > baselineAssistantCount || (await isGenerating(page))) {
      break; // 回答開始を確認
    }
    if (await hasErrorBanner(page)) {
      return { status: 'error', reason: 'error_before_start', detail: '回答開始前にエラー表示を検知しました' };
    }
    if (Date.now() > startDeadline) {
      return { status: 'timeout', phase: 'start', detail: `回答開始が${answer_start_timeout_sec}秒以内に確認できませんでした` };
    }
    await sleep(poll_interval_ms);
  }

  const startedAt = new Date().toISOString();
  const completeDeadline = Date.now() + answer_complete_timeout_sec * 1000;
  let lastText = null;
  let stableSince = null;

  // --- フェーズ2: 生成中 → 完了待ち ---
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (shouldAbortImmediately && shouldAbortImmediately()) {
      return { status: 'stopped_immediate', detail: '即時停止が要求されました', startedAt };
    }
    const t = await reconfirmTarget(context, handle);
    if (!t.ok) return { status: t.reason, detail: t.detail, startedAt };
    const page = t.page;

    const counts = await countMessages(page);
    if (counts.user > expectedUserCount) {
      return { status: 'interrupted', detail: '回答待機中に想定外のユーザーメッセージを検知しました', startedAt };
    }

    const generating = await isGenerating(page);
    const currentText = await getLatestByRole(page, 'assistant');
    const errorBanner = await hasErrorBanner(page);

    if (errorBanner && !generating) {
      return { status: 'error', reason: 'error_banner', detail: 'ChatGPT側でエラー表示を検知しました', startedAt, assistantText: currentText };
    }

    if (!generating) {
      if (currentText === lastText) {
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= answer_stable_sec * 1000) {
          return { status: 'answer_completed', startedAt, completedAt: new Date().toISOString(), assistantText: currentText || '' };
        }
      } else {
        lastText = currentText;
        stableSince = Date.now();
      }
    } else {
      lastText = currentText;
      stableSince = null;
    }

    if (Date.now() > completeDeadline) {
      return { status: 'timeout', phase: 'complete', detail: `回答完了が${answer_complete_timeout_sec}秒以内に確認できませんでした`, startedAt };
    }
    await sleep(poll_interval_ms);
  }
}

module.exports = { waitForAnswerCompletion };
