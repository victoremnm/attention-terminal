import { NextRequest, NextResponse } from "next/server";
import {
  eventFeed,
  eventFeedSourceTables,
  parseEventFeedRequest,
} from "@/lib/event-feed-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let filters: ReturnType<typeof parseEventFeedRequest>;
  try {
    filters = parseEventFeedRequest(request.nextUrl.searchParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid event feed query";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await eventFeed(filters);
    return NextResponse.json({
      data: result.data,
      fetchedAt: new Date().toISOString(),
      filters,
      provenance: {
        sql: result.sql,
        sourceTables: eventFeedSourceTables(filters),
        rowsRead: result.rowsRead,
        elapsedMs: result.elapsedMs,
      },
    });
  } catch {
    return NextResponse.json({ error: "event feed query failed" }, { status: 500 });
  }
}
