import { prisma } from "./prisma";
import type { AppConfig, InfluencerRank } from "./types";

// Follower thresholds per 要件定義書.md §10 / influencer_addon.txt:
// S: 数十万〜, A: 数万〜, B/C: それ未満(リサーチ不要)
export function rankFromFollowers(followers: number): InfluencerRank {
  if (followers >= 300_000) return "S";
  if (followers >= 10_000) return "A";
  if (followers >= 1_000) return "B";
  return "C";
}

export function isInfluencer(followers: number, config: AppConfig): boolean {
  if (!config.influencer_mode.enabled) return false;
  const rank = rankFromFollowers(followers);
  return rank === "S" || rank === "A";
}

export function isRiskFlagged(handle: string, config: AppConfig): boolean {
  return config.influencer_mode.risk_flagged_accounts.includes(handle);
}

/**
 * Looks up (and caches) the influencer research summary for a handle.
 *
 * NOTE (MVP scope): this does NOT perform live web research — the
 * requirements (影響力ランクに応じたリサーチの深さ, common_rules.txt
 * 「事実と異なる情報を断定的に書かない」) explicitly forbid using unverified
 * claims, and this app has no grounded search tool wired up yet. Wire a
 * real search/research tool into `research()` before relying on this for
 * S-rank "徹底リサーチ" in production; until then candidates for
 * influencer posts fall back to content-only patterns (10/11 excluded)
 * rather than fabricating biographical claims.
 */
export async function getInfluencerResearch(
  handle: string,
  rank: InfluencerRank,
): Promise<{ rank: InfluencerRank; researchSummary: string | null; riskFlagged: boolean }> {
  const cached = await prisma.influencerCache.findUnique({ where: { handle } });
  if (cached) {
    return {
      rank: cached.rank as InfluencerRank,
      researchSummary: cached.researchSummary,
      riskFlagged: cached.riskFlagged,
    };
  }

  const result = { rank, researchSummary: null as string | null, riskFlagged: false };
  await prisma.influencerCache.create({
    data: {
      handle,
      rank,
      researchSummary: result.researchSummary,
      riskFlagged: result.riskFlagged,
    },
  });
  return result;
}
