const fs = require('fs');
const path = require('path');

// Node.js組み込みの.env読み込み(Node 20.6+)。.envが無くてもエラーにしない。
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (_err) {
  // .env が無ければ何もしない(API未設定=モック動作)。
}

const GPTS_CONFIG_FILE = path.join(__dirname, '..', 'config', 'gpts.json');
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

function loadGptConfig(id) {
  const { gpts } = JSON.parse(fs.readFileSync(GPTS_CONFIG_FILE, 'utf8'));
  const gpt = gpts.find((g) => g.id === id);
  if (!gpt) {
    throw new Error(`config/gpts.json に "${id}" が見つかりません`);
  }
  if (!gpt.enabled) {
    throw new Error(`"${gpt.name}" は現在無効(enabled=false)です`);
  }
  return gpt;
}

function loadPromptText(promptFile) {
  const filePath = path.join(PROMPTS_DIR, promptFile);
  return fs.readFileSync(filePath, 'utf8');
}

// APIキー未設定時のモック応答。既存のNext.jsアプリと同じ考え方([MOCK/...]表記)。
function mockReply(gptName, material) {
  const preview = material.trim().slice(0, 40).replace(/\s+/g, ' ');
  return `[MOCK/${gptName}] ANTHROPIC_API_KEY未設定のため、これはダミー応答です。\n受け取った素材(先頭): ${preview}...`;
}

// 指定したGPT役割(id)へ、素材と追加指示を渡して応答を得る。
// 戻り値: { text, gptName, mocked }
async function callGpt(id, material, extraInstruction = '') {
  const gpt = loadGptConfig(id);
  const systemPrompt = loadPromptText(gpt.prompt_file);

  const userMessageParts = [];
  if (extraInstruction) {
    userMessageParts.push(`【今回の追加指示】\n${extraInstruction}`);
  }
  userMessageParts.push(`【今回の分析素材】\n<<<SOURCE>>>\n${material}\n<<<END SOURCE>>>`);
  const userMessage = userMessageParts.join('\n\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    return { text: mockReply(gpt.name, material), gptName: gpt.name, mocked: true };
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const clientOptions = { apiKey: process.env.ANTHROPIC_API_KEY };
  // 組織(ワークスペース)に紐づいたAPIキーの場合、リクエストごとに
  // どのワークスペースとして動くかを明示する必要がある。
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    clientOptions.defaultHeaders = { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID };
  }
  const client = new Anthropic(clientOptions);
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return { text, gptName: gpt.name, mocked: false };
}

module.exports = { callGpt, loadGptConfig };
