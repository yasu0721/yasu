import { prisma } from "./prisma";
import { getConfig } from "./config";
import { fetchBuzzPosts } from "./xClient";
import { classifyPost } from "./classify";
import { isInfluencer, rankFromFollowers, isRiskFlagged } from "./influencer";
import { getEligiblePatterns } from "./patternEligibility";
import { getCommentPattern, getQuotePattern } from "./rules";
import { generateCandidateContent } from "./generate";
import type { ActionType, AppConfig } from "./types";
import type { Post } from "@prisma/client";

/**
 * 「取得」ボタン: fetches 3〜30 posts (要件定義書.md §12), classifies them,
 * and upserts into the DB. Excluded posts (ads, sensitive topics, below
 * buzz threshold, ...) are stored too so the UI can grey them out with a
 * reason, per the 候補一覧の操作 spec.
 */
export async function fetchAndStorePosts(count: number): Promise<Post[]> {
  const config = await getConfig();
  const keywords = Object.values(config.genre_keywords).flat();
  const tweets = await fetchBuzzPosts(keywords, count);

  const posts: Post[] = [];
  for (const tweet of tweets) {
    const result = classifyPost(tweet, config);
    const rank = isInfluencer(tweet.authorFollowers, config)
      ? rankFromFollowers(tweet.authorFollowers)
      : null;

    const post = await prisma.post.upsert({
      where: { xPostId: tweet.xPostId },
      update: {},
      create: {
        xPostId: tweet.xPostId,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName,
        authorFollowers: tweet.authorFollowers,
        authorAvatarUrl: tweet.authorAvatarUrl,
        text: tweet.text,
        likeCount: tweet.likeCount,
        retweetCount: tweet.retweetCount,
        postedAt: tweet.postedAt,
        genre: result.genre,
        classification: result.classification,
        buzzScore: result.buzzScore,
        isAd: result.isAd,
        influencerRank: rank,
        excluded: result.excluded,
        exclusionReason: result.exclusionReason,
      },
    });
    posts.push(post);
  }
  return posts;
}

function weightedPick(weights: Record<ActionType, number>): ActionType {
  const entries = Object.entries(weights) as [ActionType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [type, w] of entries) {
    if (r < w) return type;
    r -= w;
  }
  return entries[0][0];
}

async function pickPattern(
  type: ActionType,
  eligible: { id: number; caution: boolean }[],
  config: AppConfig,
): Promise<{ id: number; caution: boolean } | null> {
  if (eligible.length === 0) return null;
  if (!config.diversity_control.avoid_repeat_pattern || eligible.length === 1) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
  const recent = await prisma.candidate.findMany({
    where: { type },
    orderBy: { createdAt: "desc" },
    take: config.diversity_control.lookback_count,
    select: { patternId: true },
  });
  const recentIds = new Set(recent.map((r) => r.patternId));
  const nonRepeating = eligible.filter((p) => !recentIds.has(p.id));
  const pool = nonRepeating.length > 0 ? nonRepeating : eligible;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 「ポスト作成」ボタン: generates comment/quote candidates for every stored,
 * non-excluded post that doesn't already have one, distributed per
 * config.schedule.daily_action_limit ratios (要件定義書.md §12).
 *
 * OWN_POST candidates aren't tied to reacting to someone else's post
 * (要件定義書.md §13 — dedicated own-post patterns are still undecided), so
 * this per-post loop only produces COMMENT/QUOTE reactions; the own_post
 * ratio is excluded from the per-post weighting below.
 */
export async function generateCandidatesForPendingPosts(): Promise<number> {
  const config = await getConfig();
  const posts = await prisma.post.findMany({
    where: { excluded: false, candidates: { none: {} } },
  });

  const weights: Record<ActionType, number> = {
    OWN_POST: 0,
    COMMENT: config.schedule.daily_action_limit.comment_ratio,
    QUOTE: config.schedule.daily_action_limit.quote_retweet_ratio,
  };

  let created = 0;
  for (const post of posts) {
    const type = weightedPick(weights);
    const influencer = post.influencerRank === "S" || post.influencerRank === "A";
    const riskFlagged = isRiskFlagged(post.authorHandle, config);

    const eligible = getEligiblePatterns(
      type,
      post.classification as Parameters<typeof getEligiblePatterns>[1],
      config,
      { isInfluencer: influencer },
    );
    const chosen = await pickPattern(type, eligible, config);
    if (!chosen) continue;

    const pattern =
      type === "COMMENT" ? getCommentPattern(chosen.id) : getQuotePattern(chosen.id);
    if (!pattern) continue;

    const result = await generateCandidateContent({
      postText: post.text,
      authorHandle: post.authorHandle,
      type,
      pattern,
      isInfluencer: influencer,
      toneOverride: post.classification === "SERIOUS" ? "serious_mode" : undefined,
    });

    await prisma.candidate.create({
      data: {
        postId: post.id,
        type,
        patternId: chosen.id,
        patternName: pattern.name + (chosen.caution || riskFlagged ? "(要確認)" : ""),
        content: result.content,
        selfCheckLog: JSON.stringify(result.selfCheckLog),
      },
    });
    created++;
  }
  return created;
}
