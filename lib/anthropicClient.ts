import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export const GENERATION_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
