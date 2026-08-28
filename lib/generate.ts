import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient, isAnthropicConfigured, GENERATION_MODEL } from "./anthropicClient";
import { loadRules, type Pattern } from "./rules";
import type { ActionType } from "./types";

export interface SelfCheckLogEntry {
  attempt: number;
  draft: string;
  passed: boolean;
  reason: string;
}

export interface GenerateResult {
  content: string;
  selfCheckLog: SelfCheckLogEntry[];
}

export interface GenerateInput {
  postText: string;
  authorHandle: string;
  type: ActionType;
  pattern: Pattern;
  isInfluencer: boolean;
  /** e.g. "serious_mode" from config.yaml pattern_eligibility.*.tone_override */
  toneOverride?: string;
}

const SelfCheckSchema = z.object({
  contains_post_specific_element: z
    .boolean()
    .describe(
      "元投稿固有の要素(具体的な数字・固有名詞・特徴的な言い回しなど)が最低1つ含まれているか",
    ),
  is_generic_template: z
    .boolean()
    .describe("他のどんな投稿にも当てはめられる一般論的なテンプレート文になっていないか"),
  reason: z.string().describe("上記2点の判定理由。書き直しが必要な場合は具体的に何を直すべきか"),
});

const MAX_ATTEMPTS = 3;

function actionLabel(type: ActionType): string {
  switch (type) {
    case "COMMENT":
      return "コメント(リプライ)";
    case "QUOTE":
      return "引用リツイート";
    case "OWN_POST":
      return "自分発信の投稿(オリジナルポスト)";
  }
}

function buildSystemPrompt(input: GenerateInput): string {
  const rules = loadRules();
  const parts = [
    rules.commonRules,
    `## 今回作成するパターン:${input.pattern.name}\n${input.pattern.body}`,
  ];
  if (input.isInfluencer) {
    parts.push(rules.influencerAddon);
  }
  if (input.toneOverride === "serious_mode") {
    parts.push(
      "## 追加指示:serious_mode\nこの投稿はシリアス系(事件・災害等)に分類されています。断定を避け、当事者への配慮を欠かさない慎重なトーンで作成してください。軽いノリ・ユーモアは使わないこと。",
    );
  }
  return parts.join("\n\n");
}

async function draft(
  systemPrompt: string,
  input: GenerateInput,
  previous?: { draft: string; reason: string },
): Promise<string> {
  const client = getAnthropicClient();
  const userPrompt = previous
    ? `以下の投稿に対して${actionLabel(input.type)}を作成してください。\n\n【元投稿】\n投稿者: @${input.authorHandle}\n本文: ${input.postText}\n\n【前回のドラフト(NG判定)】\n${previous.draft}\n\n【NG理由】\n${previous.reason}\n\n上記のNG理由を踏まえて書き直してください。出力は投稿本文のみ。`
    : `以下の投稿に対して${actionLabel(input.type)}を1件作成してください。\n\n【元投稿】\n投稿者: @${input.authorHandle}\n本文: ${input.postText}\n\n出力は投稿本文のみ。前置きや説明文、引用符は付けないこと。`;

  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
}

async function selfCheck(
  input: GenerateInput,
  draftText: string,
): Promise<{ passed: boolean; reason: string }> {
  const client = getAnthropicClient();
  const response = await client.messages.parse({
    model: GENERATION_MODEL,
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: zodOutputFormat(SelfCheckSchema),
    },
    messages: [
      {
        role: "user",
        content: `以下のドラフトをセルフチェックしてください。\n\n【元投稿】\n${input.postText}\n\n【ドラフト】\n${draftText}\n\n判定基準:\n1. ドラフト中に、元投稿固有の要素(具体的な数字・固有名詞・特徴的な言い回しなど)が最低1つ含まれているか\n2. このドラフトは、他のどんな投稿にも当てはめられる一般論的なテンプレート文になっていないか`,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    return { passed: true, reason: "セルフチェックの構造化出力に失敗したため、そのまま採用" };
  }
  const passed = parsed.contains_post_specific_element && !parsed.is_generic_template;
  return { passed, reason: parsed.reason };
}

function mockGenerate(input: GenerateInput): GenerateResult {
  const snippet = input.postText.slice(0, 12);
  const content = `[MOCK/ANTHROPIC_API_KEY未設定] 「${snippet}...」について、${input.pattern.name}のダミー候補です。`;
  return {
    content,
    selfCheckLog: [
      {
        attempt: 1,
        draft: content,
        passed: true,
        reason: "ANTHROPIC_API_KEY未設定のためモック生成(セルフチェック未実施)",
      },
    ],
  };
}

/**
 * Runs the generation loop required by 要件定義書.md §5/§14: draft → self-check
 * → rewrite (up to 3 times) → only an OK draft is returned. This is enforced
 * here in code (separate draft/check API calls) rather than left to the
 * prompt, per the explicit note in §14 that prompt-only looping wasn't
 * reliable enough.
 */
export async function generateCandidateContent(
  input: GenerateInput,
): Promise<GenerateResult> {
  if (!isAnthropicConfigured()) {
    return mockGenerate(input);
  }

  const systemPrompt = buildSystemPrompt(input);
  const log: SelfCheckLogEntry[] = [];
  let previous: { draft: string; reason: string } | undefined;
  let lastDraft = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draftText = await draft(systemPrompt, input, previous);
    lastDraft = draftText;
    const check = await selfCheck(input, draftText);
    log.push({ attempt, draft: draftText, passed: check.passed, reason: check.reason });
    if (check.passed) {
      return { content: draftText, selfCheckLog: log };
    }
    previous = { draft: draftText, reason: check.reason };
  }

  // Exhausted retries: return the last draft anyway (candidate still needs a
  // human's final GO click in 半自動 mode) but the log makes the NG history visible.
  return { content: lastDraft, selfCheckLog: log };
}
