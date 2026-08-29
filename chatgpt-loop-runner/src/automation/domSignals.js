// 回答の開始/生成中/完了を判定するためのDOM観測をここに集約する。
// ChatGPTのUI変更で特定のクラス名が変わっても、
// role/aria/構造の複数シグナルを組み合わせているため全滅しにくい設計にしている。
// ここのセレクタだけ直せば全体の検知ロジックに反映される。

// メッセージ一覧を取得する。data-message-author-role属性が使えればそれを最優先し、
// 使えない場合はarticle要素などにフォールバックする。
async function getMessages(page) {
  return page.evaluate(() => {
    function fromAuthorRoleAttr() {
      const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
      return nodes.map((n) => ({
        role: n.getAttribute('data-message-author-role') || 'unknown',
        text: n.innerText || '',
      }));
    }
    function fromArticles() {
      const nodes = Array.from(document.querySelectorAll('article'));
      return nodes.map((n) => {
        const roleAttr = n.querySelector('[data-message-author-role]');
        return {
          role: roleAttr ? roleAttr.getAttribute('data-message-author-role') : 'unknown',
          text: n.innerText || '',
        };
      });
    }
    const primary = fromAuthorRoleAttr();
    if (primary.length > 0) return primary;
    return fromArticles();
  });
}

async function countMessages(page) {
  const messages = await getMessages(page);
  return {
    total: messages.length,
    user: messages.filter((m) => m.role === 'user').length,
    assistant: messages.filter((m) => m.role === 'assistant').length,
  };
}

async function getLatestByRole(page, role) {
  const messages = await getMessages(page);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return messages[i].text;
  }
  return null;
}

const STOP_BUTTON_STRATEGIES = [
  (page) => page.getByRole('button', { name: /stop generating|stop streaming|^stop$/i }),
  (page) => page.locator('button[aria-label*="Stop" i]'),
  (page) => page.locator('button[data-testid="stop-button"]'),
];

async function isGenerating(page) {
  for (const strategy of STOP_BUTTON_STRATEGIES) {
    try {
      const locator = strategy(page).first();
      if (await locator.isVisible().catch(() => false)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

const ERROR_TEXT_PATTERN = /something went wrong|network error|there was an error|an error occurred|failed to load/i;

async function hasErrorBanner(page) {
  try {
    return await page.locator(`text=${ERROR_TEXT_PATTERN}`).first().isVisible().catch(() => false);
  } catch {
    return false;
  }
}

async function hasRegenerateButton(page) {
  try {
    return await page
      .getByRole('button', { name: /regenerate/i })
      .first()
      .isVisible()
      .catch(() => false);
  } catch {
    return false;
  }
}

module.exports = {
  getMessages,
  countMessages,
  getLatestByRole,
  isGenerating,
  hasErrorBanner,
  hasRegenerateButton,
};
