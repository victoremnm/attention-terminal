import { q } from "@/lib/queries/core";
import { parseEventPayload } from "@/lib/event-payload-parser";
import type { EventDrilldownPayload } from "@/lib/render-payload";

const EVENT_DETAIL_TABLES = ["default.github_events_firehose"];

export const dynamic = "force-dynamic";

interface EventDetailRow {
  event_type: string;
  action: string;
  repo_name: string;
  actor_login: string;
  actor_avatar: string;
  created_at: string;
  payload: string;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get("event_id");
    if (!rawId) {
      return Response.json({ error: "event_id is required" }, { status: 400 });
    }
    const eventId = Number(rawId);
    if (!Number.isInteger(eventId) || eventId < 1 || eventId > 18446744073709551615) {
      return Response.json({ error: "event_id must be a positive integer up to 2^64-1" }, { status: 400 });
    }

    const { rows, provenance } = await q<EventDetailRow>(
      `
      SELECT
        event_type,
        action,
        repo_name,
        actor_login,
        actor_avatar,
        toString(created_at) AS created_at,
        payload
      FROM default.github_events_firehose
      WHERE event_id = {eventId: UInt64}
      LIMIT 1
      `,
      EVENT_DETAIL_TABLES,
      { eventId }
    );

    if (rows.length === 0) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    const row = rows[0];
    const { structured, rawPayload, truncated } = parseEventPayload(row.event_type, row.action, row.payload);

    const payload: EventDrilldownPayload = {
      type: "event-drilldown",
      eventType: row.event_type,
      action: row.action,
      repoName: row.repo_name,
      actorLogin: row.actor_login,
      actorAvatar: row.actor_avatar,
      createdAt: row.created_at,
      structured: (structured as Record<string, unknown>) ?? null,
      rawPayload,
      rawPayloadTruncated: truncated,
      query: {
        sql: provenance.sql,
        rowsRead: provenance.rowsRead ?? 0,
        elapsedMs: provenance.elapsedMs,
      },
    };

    return Response.json(payload);
  } catch (error: unknown) {
    console.error("[event-detail]", error);
    return Response.json({ error: "Failed to fetch event detail" }, { status: 500 });
  }
}
