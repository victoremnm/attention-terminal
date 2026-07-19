import { NextResponse } from "next/server";
import { dailyDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const noiseFloor = Number(searchParams.get("noiseFloor") ?? "0");
  try {
    const digest = await dailyDigest(Number.isFinite(noiseFloor) ? noiseFloor : 0);
    return NextResponse.json(digest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "digest query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
