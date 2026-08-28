import { NextResponse } from "next/server";
import { generateCandidatesForPendingPosts } from "@/lib/pipeline";
import { isAnthropicConfigured } from "@/lib/anthropicClient";

export async function POST() {
  const created = await generateCandidatesForPendingPosts();
  return NextResponse.json({ created, mock: !isAnthropicConfigured() });
}
