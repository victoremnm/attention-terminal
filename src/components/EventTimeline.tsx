"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RenderedAnswer } from "./RenderedAnswer";
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
  eventTypeFilter?: string[];
  onFilterLoading?: (loading: boolean) => void;
}

export function EventTimeline({
  rows: initialRows,
  eventTypeFilter,
  onFilterLoading,
}: EventTimelineProps) {
  const [selected, setSelected] = useState<EventTimelineRow | undefined>();
  const [detail, setDetail] = useState<EventDrilldownPayload | undefined>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filteredRows, setFilteredRows] = useState<EventTimelineRow[] | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!eventTypeFilter || eventTypeFilter.length === 0) {
      setFilteredRows(null);
      onFilterLoading?.(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    onFilterLoading?.(true);
    const params = new URLSearchParams();
    for (const et of eventTypeFilter) params.append("eventType", et);
    params.set("window", "24h");
    fetch(`/api/events?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("filtered feed failed"))))
      .then((body) => {
        if (!cancelled) {
          setFilteredRows(body.data ?? []);
          onFilterLoading?.(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFilteredRows([]);
          onFilterLoading?.(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [eventTypeFilter, onFilterLoading]);

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

  const rows = filteredRows ?? initialRows;

  return (
    <>
      <div className="events-timeline" role="list" aria-label="Event timeline">
        {rows.length === 0 && (
          <p className="events-empty mono">
            {eventTypeFilter && eventTypeFilter.length > 0
              ? "No events match the selected filter."
              : "No events ingested yet. The firehose task runs at :05 past every hour."}
          </p>
        )}
        {rows.map((row, i) => (
          <TimelineRow key={`${row.event_id}-${i}`} row={row} onSelect={openDrawer} />
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
