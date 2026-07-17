import { logger, schedules } from "@trigger.dev/sdk";
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

function toRow(item: HNApiItem) {
  return {
    id: item.id,
    deleted: item.deleted ? 1 : 0,
    type: HN_TYPES.has(item.type ?? "") ? item.type : "story",
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
  };
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${HN_API}/${path}`);
  if (!res.ok) return null;
  return (await res.json()) as T | null;
}

async function fetchItems(ids: number[]) {
  const rows: ReturnType<typeof toRow>[] = [];
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + FETCH_CONCURRENCY);
    const items = await Promise.all(batch.map((id) => fetchJson<HNApiItem>(`item/${id}.json`)));
    for (const item of items) {
      if (item?.id) rows.push(toRow(item));
    }
  }
  return rows;
}

export const ingestHackernews = schedules.task({
  id: "ingest-hackernews",
  cron: "* * * * *",
  maxDuration: 280,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    // The database is the watermark; the task stays stateless and self-heals
    // after downtime (catch-up is capped per run, the next run continues).
    const [{ watermark }] = await selectRows<{ watermark: string }>(
      "SELECT max(id) AS watermark FROM hackernews"
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
      logger.log("Nothing to ingest", { maxKnown, maxItem });
      return { inserted: 0, maxKnown, maxItem };
    }

    const rows = await fetchItems(ids);
    if (rows.length > 0) {
      await clickhouseInsert.insert({ table: "hackernews", values: rows, format: "JSONEachRow" });
      await logIngest({
        source: "hackernews",
        chunk_key: `items:${ids[0]}-${ids[ids.length - 1]}`,
        rows_ingested: rows.length,
        watermark: maxItem,
      });
    }

    logger.log("Ingested HackerNews items", {
      newItems: newIds.length,
      updatedItems: updatedIds.length,
      inserted: rows.length,
      lag: maxItem - maxKnown,
    });
    return { inserted: rows.length, newItems: newIds.length, updatedItems: updatedIds.length };
  },
});
