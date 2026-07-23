import { NextRequest, NextResponse } from "next/server";
import { parseActiveContributionRequest } from "@/lib/active-contribution-query";
import { activeContributionRanking } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Serves the anti-noise "active contribution" ranking modes (issue #139/#140):
// distinct commits and substantive push buckets over gh_repo_actor_hourly,
// deliberately excluding zero-commit pushes and default-branch spam noise.
// Mirrors /api/trending's safe-error and query-proof shape so both ranking
// families are equally debuggable from the client.
export async function GET(request: NextRequest) {
  let parsed: ReturnType<typeof parseActiveContributionRequest>;
  try {
    parsed = parseActiveContributionRequest(request.nextUrl.searchParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid active-contribution query";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await activeContributionRanking(parsed.window, parsed.sort, parsed.limit);
    return NextResponse.json({
      data: result.data,
      proof: {
        queryId: "active_contribution_ranking",
        params: { window: parsed.window, sort: parsed.sort, limit: parsed.limit },
        sourceTables: ["gh_repo_actor_hourly"],
        elapsedMs: result.elapsedMs,
        rowsRead: result.rowsRead,
      },
    });
  } catch {
    // Keep ClickHouse internals out of the public API while preserving a
    // stable error shape for the client and integration tests.
    return NextResponse.json({ error: "active contribution query failed" }, { status: 500 });
  }
}
