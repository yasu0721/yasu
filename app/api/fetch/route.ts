import { NextRequest, NextResponse } from "next/server";
import { fetchAndStorePosts } from "@/lib/pipeline";
import { isMockMode } from "@/lib/xClient";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body.count) || 10, 3), 30);
  const posts = await fetchAndStorePosts(count);
  return NextResponse.json({ posts, mock: isMockMode() });
}
