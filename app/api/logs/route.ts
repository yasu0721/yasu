import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const logs = await prisma.actionLog.findMany({
    orderBy: { postedAt: "desc" },
    take: 200,
    include: { candidate: { include: { post: true } } },
  });
  return NextResponse.json({ logs });
}
