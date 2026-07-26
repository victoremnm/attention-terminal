import { NextRequest, NextResponse } from "next/server";
import { searchRepos } from "@/lib/queries";

export const dynamic = "force-dynamic";

const MAX_Q = 100;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, MAX_Q) ?? "";
  if (!q) {
    return NextResponse.json({ rows: [], sql: "", elapsedMs: 0 });
  }

  try {
    const result = await searchRepos(q);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
