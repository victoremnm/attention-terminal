import { NextRequest, NextResponse } from "next/server";
import { parseRepoActivityRequest } from "@/lib/repo-activity-query";
import { repoActivityWindow } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let parsed: ReturnType<typeof parseRepoActivityRequest>;
  try {
    parsed = parseRepoActivityRequest(request.nextUrl.searchParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid trending query";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await repoActivityWindow(parsed.window, parsed.options);
    return NextResponse.json({
      data: result.data,
      proof: {
        ...result.proof,
        elapsedMs: result.elapsedMs,
        rowsRead: result.rowsRead,
      },
    });
  } catch {
    // Keep ClickHouse internals out of the public API while preserving a stable
    // error shape for the client and integration tests.
    return NextResponse.json({ error: "trending query failed" }, { status: 500 });
  }
}
