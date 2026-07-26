"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RenderedAnswer } from "./RenderedAnswer";
import { useIngestPulse } from "./useIngestPulse";
import type { EventTimelineRow } from "@/lib/queries";
import type { EventDrilldownPayload } from "@/lib/render-payload";

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    PushEvent: "var(--green)",
    WatchEvent: "var(--gold)",
    ForkEvent: "var(--purple)",
    PullRequestEvent: "var(--blue)",
    IssuesEvent: "var(--red)",
    CreateEvent: "var(--cyan)",
    DeleteEvent: "var(--muted)",
    ReleaseEvent: "var(--orange)",
    IssueCommentEvent: "var(--muted)",
    PullRequestReviewEvent: "var(--blue)",
    PullRequestReviewCommentEvent: "var(--blue)",
  };
  return (
    <span
      className="mono"
      style={{
        color: colors[type] ?? "var(--muted)",
        fontSize: "10px",
        letterSpacing: ".08em",
      }}
    >
      {type.replace("Event", "")}
    </span>
  );
}

function TimelineRow({
  row,
  onSelect,
}: {
  row: EventTimelineRow;
  onSelect: (row: EventTimelineRow, el: HTMLButtonElement) => void;
}) {
  const ts = row.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <button
      type="button"
      className="events-timeline-item events-timeline-clickable"
      onClick={(e) => onSelect(row, e.currentTarget)}
      aria-label={`Inspect ${row.event_type} by ${row.actor_login}`}
    >
      <span className="mono events-timeline-time">{ts}</span>
      <EventTypeBadge type={row.event_type} />
      <span className="events-timeline-actor">{row.actor_login}</span>
      <span className="events-timeline-summary">{row.payload_summary}</span>
      <span className="mono events-timeline-repo">{row.repo_name}</span>
    </button>
  );
}

interface EventTimelineProps {
  rows: EventTimelineRow[];
  ingestToken?: string;
  eventTypeFilter?: string[];
  onFilterLoading?: (loading: boolean) => void;
}

type LiveEventRow = EventTimelineRow & { event_key?: string };

function eventIdentity(row: LiveEventRow) {
  return row.event_key || row.event_id;
}

function dedupeRows(rows: LiveEventRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const identity = eventIdentity(row);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 100);
}

export function EventTimeline({
  rows: initialRows,
  ingestToken,
  eventTypeFilter,
  onFilterLoading,
}: EventTimelineProps) {
  const [selected, setSelected] = useState<EventTimelineRow | undefined>();
  const [detail, setDetail] = useState<EventDrilldownPayload | undefined>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [visibleRows, setVisibleRows] = useState<LiveEventRow[]>(() => dedupeRows(initialRows));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
  const { lastIngestAt, error: realtimeError } = useIngestPulse(ingestToken);
  const ingestKey = lastIngestAt?.getTime() ?? 0;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    setVisibleRows(dedupeRows(initialRows));
  }, [initialRows]);

  const refresh = useCallback(async () => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    setRefreshing(true);
    onFilterLoading?.(true);
    const params = new URLSearchParams();
    for (const eventType of eventTypeFilter ?? []) params.append("eventType", eventType);
    params.set("window", eventTypeFilter?.length ? "24h" : "7d");
    try {
      const response = await fetch(`/api/events?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      const body = await response.json() as {
        data?: LiveEventRow[];
        fetchedAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "event feed refresh failed");
      if (refreshRequestRef.current !== requestId) return;
      setVisibleRows(dedupeRows(body.data ?? []));
      setUpdatedAt(body.fetchedAt ? new Date(body.fetchedAt) : new Date());
      setRefreshError(undefined);
    } catch (error) {
      if (controller.signal.aborted || refreshRequestRef.current !== requestId) return;
      setRefreshError(error instanceof Error ? error.message : "event feed refresh failed");
    } finally {
      if (refreshRequestRef.current === requestId) {
        setRefreshing(false);
        onFilterLoading?.(false);
      }
    }
  }, [eventTypeFilter, onFilterLoading]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (eventTypeFilter?.length) void refresh();
      return;
    }
    void refresh();
  }, [eventTypeFilter, refresh]);

  useEffect(() => {
    if (ingestKey) void refresh();
  }, [ingestKey, refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const stopPolling = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const startPolling = () => {
      if (timer !== undefined || document.visibilityState !== "visible") return;
      timer = window.setInterval(() => void refresh(), 60_000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    startPolling();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
      abortRef.current?.abort();
      refreshAbortRef.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeDrawer();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const openDrawer = useCallback(async (row: EventTimelineRow, opener: HTMLButtonElement) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    openerRef.current = opener;
    setSelected(row);
    setDetail(undefined);
    setError(undefined);
    setLoading(true);
    setOpen(true);
    try {
      const params = new URLSearchParams({
        event_id: row.event_id,
        event_type: row.event_type,
        repo_name: row.repo_name,
        created_at: row.created_at,
      });
      const res = await fetch(`/api/event-detail?${params.toString()}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "event detail fetch failed");
      if (requestRef.current !== requestId) return;
      setDetail(body as EventDrilldownPayload);
    } catch (e) {
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : "event detail fetch failed");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  function closeDrawer() {
    setOpen(false);
    openerRef.current?.focus();
  }

  const rows = visibleRows;
  const freshness = updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "Waiting for first refresh";

  return (
    <>
      <div className="events-timeline" role="list" aria-label="Event timeline" aria-busy={refreshing}>
        <div className="mono events-timeline-status" aria-live="polite">
          {refreshing ? "Refreshing events…" : freshness}
          {realtimeError && " · realtime unavailable; polling every 60 seconds"}
          {refreshError && <span role="alert"> · {refreshError}; showing last successful results</span>}
        </div>
        {rows.length === 0 && (
          <p className="events-empty mono">
            {eventTypeFilter && eventTypeFilter.length > 0
              ? "No events match the selected filter."
              : "No events ingested yet. The firehose task runs at :05 past every hour."}
          </p>
        )}
        {rows.map((row) => (
          <TimelineRow key={eventIdentity(row)} row={row} onSelect={openDrawer} />
        ))}
      </div>

      {open && (
        <>
          <div className="event-detail-backdrop" aria-hidden="true" onClick={closeDrawer} />
          <aside
            className="event-detail-drawer"
            role="dialog"
            aria-modal="false"
            aria-labelledby="event-detail-title"
          >
            <header className="event-detail-head">
              <div>
                <p id="event-detail-title" className="mono kicker">EVENT DETAILS</p>
                {selected && (
                  <p className="event-detail-repo mono">
                    <EventTypeBadge type={selected.event_type} />
                    {" "}{selected.repo_name}
                  </p>
                )}
              </div>
              <button
                ref={closeRef}
                type="button"
                className="event-detail-close chip"
                onClick={closeDrawer}
                aria-label="Close event details"
              >
                Close
              </button>
            </header>
            <div className="event-detail-body" aria-live="polite">
              {loading && <div className="agent-tool mono">loading event details...</div>}
              {error && <div className="agent-fault mono" role="alert">! {error}</div>}
              {detail && <RenderedAnswer payload={detail} />}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
