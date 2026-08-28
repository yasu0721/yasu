import { NextRequest, NextResponse } from "next/server";
import { regenerateCandidate, ActionError } from "@/lib/actions";
import type { ActionType } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const candidate = await regenerateCandidate(id, {
      type: body.type as ActionType | undefined,
      patternId: body.patternId ? Number(body.patternId) : undefined,
    });
    return NextResponse.json({ candidate });
  } catch (err) {
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
