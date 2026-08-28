import { NextResponse } from "next/server";
import { loadRules } from "@/lib/rules";

export async function GET() {
  const rules = loadRules();
  return NextResponse.json({
    comment: rules.commentPatterns.map((p) => ({ id: p.id, name: p.name })),
    quote: rules.quotePatterns.map((p) => ({ id: p.id, name: p.name })),
  });
}
