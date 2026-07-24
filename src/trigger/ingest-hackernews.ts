import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, logIngest, selectRows } from "../lib/clickhouse";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_NEW_PER_RUN = 5_000;
const FETCH_CONCURRENCY = 25;

const HN_TYPES = new Set(["story", "comment", "poll", "pollopt", "job"]);

interface HNApiItem {
  id: number;
  deleted?: boolean;
  type?: string;
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  poll?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  parts?: number[];
  descendants?: number;
}

interface HackerNewsRow {
  id: number;
  deleted: number;
  type: string;
  by: string;
  time: number;
  text: string;
  dead: number;
  parent: number;
  poll: number;
  kids: number[];
  url: string;
  score: number;
  title: string;
  parts: number[];
  descendants: number;
  root: number;
}

function toRow(item: HNApiItem): HackerNewsRow {
  const itemType = item.type ?? "";
  return {
    id: item.id,
    deleted: item.deleted ? 1 : 0,
    type: HN_TYPES.has(itemType) ? itemType : "story",
    by: item.by ?? "",
    time: item.time ?? 0,
    text: item.text ?? "",
    dead: item.dead ? 1 : 0,
    parent: item.parent ?? 0,
    poll: item.poll ?? 0,
    kids: item.kids ?? [],
    url: item.url ?? "",
    score: item.score ?? 0,
    title: item.title ?? "",
    parts: item.parts ?? [],
    descendants: item.descendants ?? 0,
    root: 0,
  };
}

// Resolve root story ID for a comment by walking its parent chain via the HN API.
// Depth-limited to avoid unbounded recursion on deeply nested threads.
async function resolveCommentRoot(itemId: number, _depth = 0): Promise<number> {
  if (_depth >= 20) return 0;
  const item = await fetchJson<HNApiItem>(`item/${itemId}.json`);
  if (!item) return 0;
  if (item.type === "story" || item.type === "poll") return item.id;
  if (item.parent && item.parent > 0) return resolveCommentRoot(item.parent, _depth + 1);
  return 0;
}

// Walk a story's kid chain to fetch missing comments and populate root.
// Returns newly fetched rows; depth-limited to avoid unbounded recursion.
const MAX_KID_DEPTH = 3;

async function fetchKidTree(
  kidIds: number[],
  storyRoot: number,
  existingIds: Set<number>,
  _depth = 0,
): Promise<HackerNewsRow[]> {
  if (_depth >= MAX_KID_DEPTH || kidIds.length === 0) return [];

  const missing = kidIds.filter((id) => !existingIds.has(id));
  if (missing.length === 0) return [];

  const rows: HackerNewsRow[] = [];
  for (let i = 0; i < missing.length; i += FETCH_CONCURRENCY) {
    const batch = missing.slice(i, i + FETCH_CONCURRENCY);
    const items = await Promise.all(
      batch.map((id) => fetchJson<HNApiItem>(`item/${id}.json`)),
    );
    for (const item of items) {
      if (!item?.id) continue;
      const row = toRow(item);
      if (row.type === "comment" || row.type === "pollopt") row.root = storyRoot;
      rows.push(row);
      existingIds.add(item.id);

      if (item.kids && item.kids.length > 0) {
        const kids = await fetchKidTree(item.kids, storyRoot, existingIds, _depth + 1);
        rows.push(...kids);
      }
    }
  }

  return rows;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${HN_API}/${path}`);
  if (!res.ok) throw new Error(`HN API ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T | null;
}

async function fetchItems(ids: number[]) {
  const rows: HackerNewsRow[] = [];
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + FETCH_CONCURRENCY);
    const items = await Promise.all(batch.map((id) => fetchJson<HNApiItem>(`item/${id}.json`)));
    for (const item of items) {
      if (item?.id) rows.push(toRow(item));
    }
  }
  return rows;
}

// Enrich comment rows with root story IDs and fetch missing kid subtrees.
// This is the entry point for comment tree completeness — called after the
// initial new/updated item fetch. Returns the full set of rows (original +
// newly fetched kids).
async function enrichCommentTree(rows: HackerNewsRow[]): Promise<HackerNewsRow[]> {
  const existingIds = new Set(rows.map((r) => r.id));
  const additions: HackerNewsRow[] = [];

  // Phase 1: resolve root story IDs for top-level comments via parent-chain walk
  for (const row of rows) {
    if (row.root > 0) continue;
    if (row.type === "comment" && row.parent > 0) {
      row.root = await resolveCommentRoot(row.parent);
    }
  }

  // Phase 2: walk story kid chains to fetch missing comments
  const stories = rows.filter((r) => (r.type === "story" || r.type === "poll") && r.kids.length > 0);
  for (const story of stories) {
    const storyRoot = story.id;
    const kids = await fetchKidTree(story.kids, storyRoot, existingIds);
    additions.push(...kids);
  }

  // Phase 3: resolve root for any newly fetched comments
  for (const row of additions) {
    if (row.type === "comment" && row.root === 0 && row.parent > 0) {
      row.root = await resolveCommentRoot(row.parent);
    }
  }

  return additions.length > 0 ? [...rows, ...additions] : rows;
}

export const ingestHackernews = schedules.task({
  id: "ingest-hackernews",
  cron: "* * * * *",
  maxDuration: 280,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    // "ingest" tag lets the frontend subscribe to all ingestion runs via
    // Realtime with a single tag-scoped public token.
    await tags.add("ingest");

    // The database is the watermark; the task stays stateless and self-heals
    // after downtime (catch-up is capped per run, the next run continues).
    const [{ watermark }] = await selectRows<{ watermark: string }>(
      "SELECT max(id) AS watermark FROM raw.hackernews"
    );
    const maxKnown = Number(watermark);

    const maxItem = await fetchJson<number>("maxitem.json");
    if (!maxItem) throw new Error("HN API: maxitem.json unavailable");

    const newCount = Math.max(0, Math.min(maxItem - maxKnown, MAX_NEW_PER_RUN));
    const newIds = Array.from({ length: newCount }, (_, i) => maxKnown + 1 + i);

    // Changed items (score/comment updates) - re-insert; ReplacingMergeTree dedups.
    const updates = await fetchJson<{ items?: number[] }>("updates.json");
    const updatedIds = (updates?.items ?? []).filter((id) => id <= maxKnown);

    const ids = [...new Set([...newIds, ...updatedIds])];
    if (ids.length === 0) {
      metadata.set("ingest", { source: "hackernews", inserted: 0, watermark: maxItem });
      logger.log("Nothing to ingest", { maxKnown, maxItem });
      return { inserted: 0, maxKnown, maxItem };
    }

    const rows = await fetchItems(ids);
    const enriched = rows.length > 0 ? await enrichCommentTree(rows) : rows;
    if (enriched.length > 0) {
      await clickhouseInsert.insert({ table: "default.hackernews", values: enriched, format: "JSONEachRow" });
      await logIngest({
        source: "hackernews",
        chunk_key: `items:${ids[0]}-${ids[ids.length - 1]}`,
        rows_ingested: enriched.length,
        watermark: maxItem,
      });
    }

    metadata.set("ingest", {
      source: "hackernews",
      inserted: enriched.length,
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      kidItems: enriched.length - rows.length,
      watermark: maxItem,
    });
    logger.log("Ingested HackerNews items", {
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      inserted: enriched.length,
      kidItems: enriched.length - rows.length,
      lag: maxItem - maxKnown,
    });
    return { inserted: enriched.length, newItems: newIds.length, updatedItems: updatedIds.length, kidItems: enriched.length - rows.length };
  },
});
