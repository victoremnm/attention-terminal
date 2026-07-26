import { q } from "./queries/core";
import type { QueryResult } from "./queries/types";

export type EventFeedWindow = "1h" | "6h" | "24h" | "7d" | "30d";

export interface EventFeedFilters {
  window: EventFeedWindow;
  eventTypes: string[];
  repo: string;
  actor: string;
  ref: string;
  search: string;
}

export interface EventFeedRow {
  event_id: string;
  event_key: string;
  created_at: string;
  repo_name: string;
  actor_login: string;
  actor_avatar: string;
  event_type: string;
  action: string;
  ref_type: string;
  ref: string;
  title: string | null;
  number: string;
  payload_summary: string;
}

export const EVENT_FEED_RAW_TABLE = "default.github_events_firehose";
export const EVENT_FEED_TIMELINE_TABLE = "curated.event_timeline";
export const EVENT_FEED_MAX_LIMIT = 100;

const WINDOWS: Record<EventFeedWindow, string> = {
  "1h": "INTERVAL 1 HOUR",
  "6h": "INTERVAL 6 HOUR",
  "24h": "INTERVAL 24 HOUR",
  "7d": "INTERVAL 7 DAY",
  "30d": "INTERVAL 30 DAY",
};

const EVENT_TYPE = /^[A-Za-z][A-Za-z0-9]+Event$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTOR_OR_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const MAX_EVENT_TYPES = 20;
const MAX_FILTER_LENGTH = 200;

function invalid(message: string): never {
  throw new Error(message);
}

function filterText(value: string | null, name: string) {
  const normalized = value?.trim() ?? "";
  if (normalized.length > MAX_FILTER_LENGTH) invalid(`${name} must be at most ${MAX_FILTER_LENGTH} characters`);
  if (normalized && !ACTOR_OR_TEXT.test(normalized)) invalid(`${name} contains invalid control characters`);
  return normalized;
}

function eventTypes(searchParams: URLSearchParams) {
  const values = searchParams
    .getAll("eventType")
    .concat(searchParams.getAll("event_type"), searchParams.getAll("type"))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length > MAX_EVENT_TYPES) invalid(`eventType must contain at most ${MAX_EVENT_TYPES} values`);
  if (unique.some((value) => !EVENT_TYPE.test(value))) invalid("eventType contains an invalid value");
  return unique;
}

export function parseEventFeedRequest(searchParams: URLSearchParams): EventFeedFilters {
  const rawWindow = searchParams.get("window") ?? "7d";
  if (!Object.hasOwn(WINDOWS, rawWindow)) invalid("window is not supported");

  const repo = filterText(searchParams.get("repo"), "repo");
  if (repo && !REPO.test(repo)) invalid("repo must be an owner/repo name");

  return {
    window: rawWindow as EventFeedWindow,
    eventTypes: eventTypes(searchParams),
    repo,
    actor: filterText(searchParams.get("actor"), "actor"),
    ref: filterText(searchParams.get("ref"), "ref"),
    search: filterText(searchParams.get("search"), "search"),
  };
}

const SUMMARY_SQL = `multiIf(
  event_type = 'PushEvent', if(JSONExtractString(payload, 'ref') != '', concat('pushed to ', replaceRegexpOne(JSONExtractString(payload, 'ref'), '^refs/heads/', '')), 'pushed'),
  event_type = 'WatchEvent', 'starred the repo',
  event_type = 'ForkEvent', 'forked the repo',
  event_type = 'PullRequestEvent', concat(action, ' PR #', toString(number)),
  event_type = 'IssuesEvent', concat(action, ' issue #', toString(number)),
  event_type = 'CreateEvent', if(ref_type != '', concat('created ', ref_type), 'created'),
  event_type = 'DeleteEvent', if(ref_type != '', concat('deleted ', ref_type), 'deleted'),
  event_type = 'ReleaseEvent', concat('published ', coalesce(title, '')),
  event_type)`;

export function eventFeedSourceTables(filters: EventFeedFilters) {
  return [filters.ref ? EVENT_FEED_RAW_TABLE : EVENT_FEED_TIMELINE_TABLE];
}

export function buildEventFeedQuery(filters: EventFeedFilters) {
  const from = filters.ref ? EVENT_FEED_RAW_TABLE : EVENT_FEED_TIMELINE_TABLE;
  const source = filters.ref ? "raw" : "timeline";
  const predicates = [
    `${source}.created_at >= now() - ${WINDOWS[filters.window]}`,
    ...(filters.eventTypes.length ? ["event_type IN {eventTypes: Array(String)}"] : []),
    ...(filters.repo ? [`${source}.repo_name = {repo: String}`] : []),
    ...(filters.actor ? [`${source}.actor_login = {actor: String}`] : []),
    ...(filters.ref ? ["positionCaseInsensitiveUTF8(JSONExtractString(raw.payload, 'ref'), {ref: String}) > 0"] : []),
    ...(filters.search
      ? [
          source === "raw"
            ? "positionCaseInsensitiveUTF8(concat(raw.repo_name, ' ', raw.actor_login, ' ', raw.event_type, ' ', raw.action, ' ', ifNull(raw.title, ''), ' ', JSONExtractString(raw.payload, 'ref')), {search: String}) > 0"
            : "positionCaseInsensitiveUTF8(concat(timeline.repo_name, ' ', timeline.actor_login, ' ', timeline.event_type, ' ', timeline.action, ' ', ifNull(timeline.title, ''), ' ', timeline.payload_summary), {search: String}) > 0",
        ]
      : []),
  ];

  return `
    SELECT
      toString(${source}.event_id) AS event_id,
      concat('github:', toString(${source}.event_id)) AS event_key,
      toString(${source}.created_at) AS created_at,
      repo_name,
      actor_login,
      actor_avatar,
      event_type,
      action,
      ${source === "raw" ? "ref_type" : "''"} AS ref_type,
      ${source === "raw" ? "JSONExtractString(raw.payload, 'ref')" : "''"} AS ref,
      title,
      toString(number) AS number,
      ${source === "raw" ? SUMMARY_SQL : "timeline.payload_summary"} AS payload_summary
    FROM ${from} AS ${source}
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY ${source}.created_at DESC, ${source}.event_id DESC
    LIMIT ${EVENT_FEED_MAX_LIMIT}
  `.trim();
}

export async function eventFeed(filters: EventFeedFilters): Promise<QueryResult<EventFeedRow[]>> {
  const sql = buildEventFeedQuery(filters);
  const { rows, provenance } = await q<EventFeedRow>(sql, eventFeedSourceTables(filters), {
    ...(filters.eventTypes.length ? { eventTypes: filters.eventTypes } : {}),
    ...(filters.repo ? { repo: filters.repo } : {}),
    ...(filters.actor ? { actor: filters.actor } : {}),
    ...(filters.ref ? { ref: filters.ref } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  });
  return {
    data: rows,
    sql: provenance.sql,
    rowsRead: provenance.rowsRead ?? 0,
    elapsedMs: provenance.elapsedMs,
  };
}
