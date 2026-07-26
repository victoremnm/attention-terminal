"use client";

import { useMemo, useState } from "react";

const EVENT_TYPE_COLORS: Record<string, string> = {
  PushEvent: "var(--green)",
  WatchEvent: "var(--gold)",
  ForkEvent: "var(--purple)",
  PullRequestEvent: "var(--blue)",
  IssuesEvent: "var(--red)",
  CreateEvent: "var(--cyan)",
  DeleteEvent: "var(--muted)",
  ReleaseEvent: "var(--orange)",
  IssueCommentEvent: "var(--tinted)",
  PullRequestReviewEvent: "#4fc3f7",
  PullRequestReviewCommentEvent: "#4fc3f7",
};

const COLOR_PALETTE = [
  "var(--green)", "var(--gold)", "var(--purple)", "var(--blue)",
  "var(--red)", "var(--cyan)", "var(--orange)", "var(--mag)",
  "#4fc3f7", "#a855f7", "#ec4899", "#84cc16",
  "#f97316", "#06b6d4", "#8b5cf6", "#14b8a6",
];

function colorFor(type: string): string {
  if (EVENT_TYPE_COLORS[type]) return EVENT_TYPE_COLORS[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = ((hash << 5) - hash) + type.charCodeAt(i);
    hash |= 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function shortType(type: string): string {
  const t = type.replace("Event", "").replace("PullRequest", "PR");
  return t.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export interface HourlyRow {
  hour_bucket: string;
  event_type: string;
  event_count: string;
  actor_count: string;
}

export interface EventTypeExplorerProps {
  hourlyData: HourlyRow[];
  onFilterChange?: (eventTypes: string[]) => void;
  activeEventTypes?: string[];
}

export function EventTypeExplorer({
  hourlyData,
  onFilterChange,
  activeEventTypes = [],
}: EventTypeExplorerProps) {
  const [selected, setSelected] = useState<string[]>(activeEventTypes);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const { topTypes, hourlyByType, hours, maxCount, chartHeight } = useMemo(() => {
    const totals = new Map<string, number>();
    const byType = new Map<string, Map<string, number>>();
    const hourSet = new Set<string>();

    for (const row of hourlyData) {
      const c = Number(row.event_count);
      totals.set(row.event_type, (totals.get(row.event_type) ?? 0) + c);
      if (!byType.has(row.event_type)) byType.set(row.event_type, new Map());
      byType.get(row.event_type)!.set(row.hour_bucket, c);
      hourSet.add(row.hour_bucket);
    }

    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([type]) => type);

    const sortedHours = [...hourSet].sort();

    const max = Math.max(...totals.values(), 1);
    const chartH = top.length * (TOP_TYPES_BAR_H + TOP_TYPES_GAP);
    const chartHeight = Math.max(chartH + 30, 50);

    return { topTypes: top, hourlyByType: byType, hours: sortedHours, maxCount: max, chartHeight };
  }, [hourlyData]);

  function toggleType(type: string) {
    setSelected((prev) => {
      const next = prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type];
      return next;
    });
  }

  function applyFilter() {
    onFilterChange?.(selected);
  }

  function clearFilter() {
    setSelected([]);
    onFilterChange?.([]);
  }

  if (!hourlyData || hourlyData.length === 0) {
    return (
      <div className="events-type-explorer">
        <p className="events-empty mono">No event type data available yet.</p>
      </div>
    );
  }

  return (
    <div className="events-type-explorer">
      <div className="events-type-chart">
        <svg
          viewBox={`0 0 ${TOP_TYPES_W} ${chartHeight}`}
          role="img"
          aria-label="Event type distribution chart"
          style={{ width: "100%", height: "auto", maxWidth: TOP_TYPES_W }}
        >
          <TopTypesChart
            topTypes={topTypes}
            hourlyByType={hourlyByType}
            hours={hours}
            maxCount={maxCount}
            selected={selected}
            highlighted={highlighted}
            onHighlight={setHighlighted}
          />
        </svg>
      </div>

      <div className="events-type-legend">
        {topTypes.map((type, idx) => {
          const color = colorFor(type);
          const isActive = selected.includes(type);
          const isHighlighted = highlighted === type;
          return (
            <button
              key={type}
              type="button"
              className={`events-type-legend-item mono ${isActive ? "is-active" : ""}`}
              style={{
                "--type-color": color,
                opacity: highlighted && !isHighlighted ? 0.4 : 1,
              } as React.CSSProperties}
              onClick={() => toggleType(type)}
              onMouseEnter={() => setHighlighted(type)}
              onMouseLeave={() => setHighlighted(null)}
              aria-pressed={isActive}
              aria-label={`${type} — click to ${
                isActive ? "remove from" : "add to"
              } filter`}
            >
              <span className="events-type-legend-swatch" />
              <span className="events-type-legend-label">
                {shortType(type)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="events-type-actions">
        <button
          type="button"
          className="chip"
          onClick={applyFilter}
          disabled={selected.length === 0}
        >
          Apply filter ({selected.length})
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="chip chip-soft"
            onClick={clearFilter}
          >
            Clear
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="events-type-active-filters mono">
          Filtering by: {selected.map((t) => shortType(t)).join(", ")}
        </div>
      )}

      <details className="events-type-table-wrapper">
        <summary className="mono events-type-table-toggle">
          View hourly data table
        </summary>
        <div className="events-type-table-scroll">
          <table className="events-type-table">
            <thead>
              <tr>
                <th>Hour</th>
                {topTypes.map((type, idx) => (
                  <th key={type} style={{ color: colorFor(type) }}>
                    {shortType(type)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour}>
                  <td className="mono">{hour.slice(11, 16)}</td>
                  {topTypes.map((type) => (
                    <td key={`${hour}-${type}`} className="mono">
                      {hourlyByType.get(type)?.get(hour)?.toLocaleString() ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const TOP_TYPES_W = 720;
const TOP_TYPES_BAR_H = 20;
const TOP_TYPES_GAP = 18;

function TopTypesChart({
  topTypes,
  hourlyByType,
  hours,
  maxCount,
  selected,
  highlighted,
  onHighlight,
}: {
  topTypes: string[];
  hourlyByType: Map<string, Map<string, number>>;
  hours: string[];
  maxCount: number;
  selected: string[];
  highlighted: string | null;
  onHighlight: (type: string | null) => void;
}) {
  const padL = 86;
  const padR = 12;
  const chartW = TOP_TYPES_W - padL - padR;

  return topTypes.map((type, idx) => {
    const total = [...(hourlyByType.get(type)?.values() ?? [])].reduce(
      (s, v) => s + v,
      0
    );
    const barW = (Math.log(total + 1) / Math.log(maxCount + 1)) * chartW;
    const y = idx * (TOP_TYPES_BAR_H + TOP_TYPES_GAP);
    const color = colorFor(type);
    return (
      <g
        key={type}
        className="events-type-bar-group"
        onMouseEnter={() => onHighlight(type)}
        onMouseLeave={() => onHighlight(null)}
        role="group"
        aria-label={type}
      >
        <text
          x={padL - 8}
          y={y + TOP_TYPES_BAR_H / 2 + 4}
          fontSize="10"
          fontWeight={selected.includes(type) ? "700" : "500"}
          fill="var(--ink)"
          textAnchor="end"
          className="mono"
          opacity={1}
        >
          {shortType(type)}
        </text>
        <rect
          x={padL}
          y={y}
          width={Math.max(1, barW)}
          height={TOP_TYPES_BAR_H}
          fill={color}
          opacity={0.92}
          rx={3}
        />
        <text
          x={padL + Math.max(1, barW) + 6}
          y={y + TOP_TYPES_BAR_H / 2 + 4}
          fontSize="10"
          fontWeight="600"
          fill="var(--muted)"
          className="mono"
          opacity={1}
        >
          {total.toLocaleString()}
        </text>
      </g>
    );
  });
}
