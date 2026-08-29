// ChatGPTの入力欄(composer)検出の共通関数。
// 特定のCSSセレクタ1個だけに依存せず、role/aria-label/contenteditable/placeholderの
// 複数候補を優先順位付きで試す。ChatGPTのUI変更でどれか1つが失敗しても他で拾えるようにする。
const CANDIDATE_STRATEGIES = [
  (page) => page.getByRole('textbox', { name: /message|prompt|send a message/i }),
  (page) => page.locator('#prompt-textarea'),
  (page) => page.locator('form div[contenteditable="true"]'),
  (page) => page.locator('div[contenteditable="true"]'),
  (page) => page.locator('textarea[placeholder]'),
  (page) => page.locator('[role="textbox"]'),
];

async function findComposer(page) {
  for (const strategy of CANDIDATE_STRATEGIES) {
    try {
      const locator = strategy(page).first();
      const count = await locator.count();
      if (count === 0) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      return locator;
    } catch {
      continue;
    }
  }
  return null;
}

async function getComposerText(locator) {
  try {
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'textarea' || tag === 'input') {
      return await locator.inputValue();
    }
    return await locator.evaluate((el) => el.innerText || '');
  } catch {
    return '';
  }
}

async function isComposerEmpty(locator) {
  const text = await getComposerText(locator);
  return text.trim().length === 0;
}

// contenteditableとtextareaの両方に対応。fill()が使えない構造の場合はキー入力へフォールバック。
async function setComposerText(locator, text) {
  try {
    await locator.fill(text);
    return;
  } catch {
    // fallback
  }
  await locator.click();
  await locator.press('Control+A').catch(() => {});
  await locator.press('Delete').catch(() => {});
  await locator.type(text);
}

const SEND_BUTTON_STRATEGIES = [
  (page) => page.getByRole('button', { name: /send message|send prompt|^send$/i }),
  (page) => page.locator('button[data-testid="send-button"]'),
  (page) => page.locator('button[aria-label*="Send" i]'),
];

async function findSendButton(page) {
  for (const strategy of SEND_BUTTON_STRATEGIES) {
    try {
      const locator = strategy(page).first();
      const count = await locator.count();
      if (count === 0) continue;
      return locator;
    } catch {
      continue;
    }
  }
  return null;
}

module.exports = { findComposer, getComposerText, isComposerEmpty, setComposerText, findSendButton };
