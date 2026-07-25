import { clickhouse, clickhouseInsert, logIngest, selectRows } from "../lib/clickhouse";
import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_NEW_PER_RUN = 5_000;
const FETCH_CONCURRENCY = 25;
const MAX_KID_DEPTH = 3;
const MAX_PARENT_CHAIN = 20;

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

async function fetchHnWatermark(): Promise<number> {
  const [row] = await selectRows<{ watermark: string }>(
    `SELECT coalesce(
      (SELECT max(watermark) FROM default.ingest_watermark WHERE source = 'hackernews'),
      (SELECT max(id) FROM raw.hackernews)
    ) AS watermark`,
  );
  return Number(row?.watermark ?? 0);
}

async function writeHnWatermark(watermark: number) {
  await clickhouseInsert.insert({
    table: "default.ingest_watermark",
    values: [{ source: "hackernews", watermark }],
    format: "JSONEachRow",
  });
}

// Resolve root story ID for a comment by walking its parent chain via the HN API.
// Depth-limited to avoid unbounded recursion on deeply nested threads.
async function resolveCommentRoot(itemId: number, _depth = 0): Promise<number> {
  if (_depth >= MAX_PARENT_CHAIN) return 0;
  const item = await fetchJson<HNApiItem>(`item/${itemId}.json`);
  if (!item) return 0;
  if (item.type === "story" || item.type === "poll") return item.id;
  if (item.parent && item.parent > 0) return resolveCommentRoot(item.parent, _depth + 1);
  return 0;
}

// Walk a story's kid chain to fetch missing comments and populate root.
// Returns newly fetched rows; depth-limited to avoid unbounded recursion.
// Unlike v1, this always recurses into fetched items' own kids arrays even
// when all direct kids were already present in existingIds.
async function fetchKidTree(
  kidIds: number[],
  storyRoot: number,
  existingIds: Set<number>,
  _depth = 0,
): Promise<HackerNewsRow[]> {
  if (_depth >= MAX_KID_DEPTH || kidIds.length === 0) return [];

  const missing = kidIds.filter((id) => !existingIds.has(id));
  const rows: HackerNewsRow[] = [];

  if (missing.length > 0) {
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
      }
    }
  }

  // Always recurse into fetched items' kid arrays, even when the direct
  // kids were already in existingIds (need to fetch grandchildren).
  const allFetched = rows.length > 0
    ? rows
    : kidIds.map((id) => ({ id } as HNApiItem));

  for (const item of allFetched) {
    if (item.kids && item.kids.length > 0) {
      const kids = await fetchKidTree(item.kids, storyRoot, existingIds, _depth + 1);
      rows.push(...kids);
    }
  }

  return rows;
}

// Enrich comment rows with root story IDs and fetch missing kid subtrees.
// Called after the initial new/updated item fetch. Returns the full set of
// rows (original + newly fetched kids).
async function enrichCommentTree(rows: HackerNewsRow[]): Promise<HackerNewsRow[]> {
  const existingIds = new Set(rows.map((r) => r.id));
  const additions: HackerNewsRow[] = [];

  // Phase 1: resolve root story IDs for comments — batched with FETCH_CONCURRENCY
  // to avoid sequential HTTP walks on large catch-up batches.
  const comments = rows.filter((r) => r.root === 0 && r.type === "comment" && r.parent > 0);
  for (let i = 0; i < comments.length; i += FETCH_CONCURRENCY) {
    const batch = comments.slice(i, i + FETCH_CONCURRENCY);
    const roots = await Promise.all(batch.map((r) => resolveCommentRoot(r.parent)));
    for (let j = 0; j < batch.length; j++) {
      batch[j].root = roots[j];
    }
  }

  // Phase 2: walk story kid chains to fetch missing comments
  const stories = rows.filter((r) => (r.type === "story" || r.type === "poll") && r.kids.length > 0);
  for (const story of stories) {
    const storyRoot = story.id;
    const kids = await fetchKidTree(story.kids, storyRoot, existingIds);
    additions.push(...kids);
  }

  // Phase 3: resolve root for any newly fetched comments — also batched
  const newComments = additions.filter((r) => r.root === 0 && r.type === "comment" && r.parent > 0);
  for (let i = 0; i < newComments.length; i += FETCH_CONCURRENCY) {
    const batch = newComments.slice(i, i + FETCH_CONCURRENCY);
    const roots = await Promise.all(batch.map((r) => resolveCommentRoot(r.parent)));
    for (let j = 0; j < batch.length; j++) {
      batch[j].root = roots[j];
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
    await tags.add("ingest");

    // Sequential high-water mark from ingest_watermark table (decoupled
    // from max(id) in raw.hackernews so kid-traversal items with higher
    // global IDs never advance the cursor).
    const maxKnown = await fetchHnWatermark();
    const maxItem = await fetchJson<number>("maxitem.json");
    if (!maxItem) throw new Error("HN API: maxitem.json unavailable");

    const newCount = Math.max(0, Math.min(maxItem - maxKnown, MAX_NEW_PER_RUN));
    const newIds = Array.from({ length: newCount }, (_, i) => maxKnown + 1 + i);

    const updates = await fetchJson<{ items?: number[] }>("updates.json");
    const updatedIds = (updates?.items ?? []).filter((id) => id <= maxKnown);

    const ids = [...new Set([...newIds, ...updatedIds])];
    if (ids.length === 0) {
      await writeHnWatermark(maxItem);
      metadata.set("ingest", { source: "hackernews", inserted: 0, watermark: maxItem });
      logger.log("Nothing to ingest", { maxKnown, maxItem });
      return { inserted: 0, maxKnown, maxItem };
    }

    const seqWatermark = Math.max(maxKnown, ...ids);

    const rows = await fetchItems(ids);
    const enriched = rows.length > 0 ? await enrichCommentTree(rows) : rows;

    if (enriched.length > 0) {
      await clickhouseInsert.insert({ table: "default.hackernews", values: enriched, format: "JSONEachRow" });
      await writeHnWatermark(seqWatermark);
      await logIngest({
        source: "hackernews",
        chunk_key: `items:${ids[0]}-${ids[ids.length - 1]}`,
        rows_ingested: enriched.length,
        watermark: seqWatermark,
      });
    }

    metadata.set("ingest", {
      source: "hackernews",
      inserted: enriched.length,
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      kidItems: enriched.length - rows.length,
      watermark: seqWatermark,
    });
    logger.log("Ingested HackerNews items", {
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      inserted: enriched.length,
      kidItems: enriched.length - rows.length,
      lag: Math.max(0, maxItem - seqWatermark),
    });
    return {
      inserted: enriched.length,
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      kidItems: enriched.length - rows.length,
    };
  },
});
