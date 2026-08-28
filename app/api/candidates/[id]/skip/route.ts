import { NextResponse } from "next/server";
import { skipCandidate, ActionError } from "@/lib/actions";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const log = await skipCandidate(id);
    return NextResponse.json({ log });
  } catch (err) {
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
