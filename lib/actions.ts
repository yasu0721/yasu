import { prisma } from "./prisma";
import { getConfig } from "./config";
import { getCommentPattern, getQuotePattern } from "./rules";
import { generateCandidateContent } from "./generate";
import { postReply, postQuoteTweet, postOriginalTweet } from "./xClient";
import { isInfluencer, isRiskFlagged } from "./influencer";
import type { ActionType } from "./types";

export class ActionError extends Error {}

function resolvePattern(type: ActionType, patternId: number) {
  return type === "COMMENT" ? getCommentPattern(patternId) : getQuotePattern(patternId);
}

export async function regenerateCandidate(
  candidateId: string,
  override?: { type?: ActionType; patternId?: number },
) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { post: true },
  });
  if (!candidate) throw new ActionError("candidate not found");
  if (candidate.status !== "PENDING") {
    throw new ActionError("posted/skipped candidates can't be regenerated");
  }

  const type = override?.type ?? (candidate.type as ActionType);
  const patternId = override?.patternId ?? candidate.patternId;
  const pattern = resolvePattern(type, patternId);
  if (!pattern) throw new ActionError("unknown pattern for this type");

  const config = await getConfig();
  const influencer = isInfluencer(candidate.post.authorFollowers, config);
  const riskFlagged = isRiskFlagged(candidate.post.authorHandle, config);

  const result = await generateCandidateContent({
    postText: candidate.post.text,
    authorHandle: candidate.post.authorHandle,
    type,
    pattern,
    isInfluencer: influencer,
    toneOverride: candidate.post.classification === "SERIOUS" ? "serious_mode" : undefined,
  });

  return prisma.candidate.update({
    where: { id: candidateId },
    data: {
      type,
      patternId,
      patternName: pattern.name + (riskFlagged ? "(要確認)" : ""),
      content: result.content,
      selfCheckLog: JSON.stringify(result.selfCheckLog),
    },
  });
}

export async function postCandidate(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { post: true },
  });
  if (!candidate) throw new ActionError("candidate not found");
  if (candidate.status !== "PENDING") {
    throw new ActionError("candidate already posted or skipped");
  }

  let tweetId: string;
  if (candidate.type === "COMMENT") {
    tweetId = await postReply(candidate.post.xPostId, candidate.content);
  } else if (candidate.type === "QUOTE") {
    tweetId = await postQuoteTweet(candidate.post.xPostId, candidate.content);
  } else {
    tweetId = await postOriginalTweet(candidate.content);
  }

  await prisma.candidate.update({
    where: { id: candidateId },
    data: { status: "POSTED" },
  });
  return prisma.actionLog.create({
    data: { candidateId, action: "posted", postedTweetId: tweetId },
  });
}

export async function skipCandidate(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new ActionError("candidate not found");
  if (candidate.status !== "PENDING") {
    throw new ActionError("candidate already posted or skipped");
  }
  await prisma.candidate.update({ where: { id: candidateId }, data: { status: "SKIPPED" } });
  return prisma.actionLog.create({ data: { candidateId, action: "skipped" } });
}
