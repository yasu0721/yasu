import fs from "node:fs";
import path from "node:path";

const SPEC_DIR = path.join(process.cwd(), "spec");

function read(relPath: string): string {
  return fs.readFileSync(path.join(SPEC_DIR, relPath), "utf-8");
}

export interface Pattern {
  id: number;
  name: string;
  body: string;
}

/**
 * Parses the "## パターンN:名前" sections out of comment_patterns.txt /
 * quote_patterns.txt. Divider lines made purely of ━ are stripped first so
 * they don't leak into the body text handed to the model.
 */
function parsePatterns(raw: string): Pattern[] {
  const cleaned = raw.replace(/^━+\s*$/gm, "");
  const headerRe = /^##\s*パターン(\d+)[:：]\s*(.+?)\s*$/gm;
  const matches = [...cleaned.matchAll(headerRe)];
  const patterns: Pattern[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = Number(match[1]);
    const name = match[2].trim();
    const bodyStart = match.index! + match[0].length;
    const bodyEnd =
      i + 1 < matches.length ? matches[i + 1].index! : cleaned.length;
    const body = cleaned.slice(bodyStart, bodyEnd).trim();
    patterns.push({ id, name, body });
  }
  return patterns;
}

let cache: {
  commonRules: string;
  influencerAddon: string;
  commentPatterns: Pattern[];
  quotePatterns: Pattern[];
} | null = null;

export function loadRules() {
  if (cache) return cache;
  cache = {
    commonRules: read("common_rules.txt"),
    influencerAddon: read("influencer_addon.txt"),
    commentPatterns: parsePatterns(read("prompts/comment_patterns.txt")),
    quotePatterns: parsePatterns(read("prompts/quote_patterns.txt")),
  };
  return cache;
}

export function getCommentPattern(id: number): Pattern | undefined {
  return loadRules().commentPatterns.find((p) => p.id === id);
}

export function getQuotePattern(id: number): Pattern | undefined {
  return loadRules().quotePatterns.find((p) => p.id === id);
}
