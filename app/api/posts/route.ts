import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const posts = await prisma.post.findMany({
    orderBy: { fetchedAt: "desc" },
    include: { candidates: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ posts });
}
