import { NextRequest, NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/config";

export async function GET() {
  const config = await getConfig();
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const config = await updateConfig(body);
  return NextResponse.json({ config });
}
