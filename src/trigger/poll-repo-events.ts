// Real-time repo events poller.
//
// Fills the ~1h gap between GH Archive hourly loads by polling the GitHub
// Events API for every engaged watchlist repo and writing into the same
// ReplacingMergeTree stream table the firehose uses. Design notes:
//
// - Rotation: the watchlist (~94 repos after the migration-22 prune) is
//   polled in least-recently-polled order, 25 per run, so every repo is
//   visited about every 4 minutes. Worst-case quota spend is ~1,500 req/hr,
//   well under the 5,000/hr authenticated budget alongside the other REST
//   tasks.
// - ETag: every response (200 or 304) upserts the repo's ETag row, so 304
//   responses — which cost zero quota — still advance the rotation cursor.
// - Dedup: only events with id greater than the repo's max(event_id) already
//   in the stream are inserted. This is the load-bearing dedup for the
//   aggregate MVs: they fire on every INSERT, so re-inserting an event would
//   double count even though the stream RMT would merge the copy away. The
//   GH Archive load independently anti-joins on event_id, so events that
//   land here first are skipped there.

import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";
import { authHeaders, chDateTime } from "../lib/github-repo";

const MAX_REPOS_PER_RUN = 25;
const PER_PAGE = 100;
const FETCH_CONCURRENCY = 4;
const MAX_DURATION_SECONDS = 120;
const RUN_DEADLINE_BUFFER_MS = 20_000;

const STREAM_TABLE = "default.github_events_stream";
const ETAG_TABLE = "default.events_api_etags";
const API_BASE = "https://api.github.com";

interface ApiEvent {
  id: string;
  type: string;
  actor?: { login?: string; avatar_url?: string };
  repo?: { name?: string };
  payload?: Record<string, unknown>;
  created_at?: string;
}

interface StreamRow {
  event_id: string;
  event_type: string;
  actor_login: string;
  actor_avatar: string;
  repo_name: string;
  owner: string;
  created_at: string;
  action: string;
  ref_type: string;
  number: number;
  title: string | null;
  payload: string;
}

// Rotate by least-recently-polled so all watchlist repos are covered even
// though a run only visits MAX_REPOS_PER_RUN of them. Repos never polled sort
// first (NULLS FIRST), which also cold-starts the ETag cache quickly.
async function pickRepos(): Promise<string[]> {
  const rows = await selectRows<{ repo_name: string }>(
    `SELECT w.repo_name AS repo_name
     FROM watchlist AS w
     LEFT JOIN (
       SELECT repo_name, max(updated_at) AS last_polled
       FROM ${ETAG_TABLE}
       GROUP BY repo_name
     ) AS e ON e.repo_name = w.repo_name
     ORDER BY e.last_polled ASC NULLS FIRST, w.priority DESC, w.repo_name ASC
     LIMIT ${MAX_REPOS_PER_RUN}`
  );
  return rows.map((r) => r.repo_name);
}

// GitHub constrains repo names to [A-Za-z0-9._-]; reject anything else
// instead of escaping it into SQL.
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function repoState(repoName: string): Promise<{ etag: string; maxEventId: string } | null> {
  if (!REPO_NAME.test(repoName)) {
    logger.log("Skipping watchlist row with invalid repo name", { repoName });
    return null;
  }
  const [etagRows, watermarkRows] = await Promise.all([
    selectRows<{ etag: string }>(
      `SELECT argMax(etag, updated_at) AS etag FROM ${ETAG_TABLE} WHERE repo_name = '${repoName}'`
    ),
    selectRows<{ max_id: string }>(
      `SELECT toString(max(event_id)) AS max_id FROM ${STREAM_TABLE} WHERE repo_name = '${repoName}'`
    ),
  ]);
  return {
    etag: etagRows[0]?.etag ?? "",
    maxEventId: watermarkRows[0]?.max_id ?? "0",
  };
}

function toRow(ev: ApiEvent): StreamRow | null {
  const repoName = ev.repo?.name ?? "";
  if (!ev.id || !ev.type || !repoName.includes("/")) return null;
  const payload = ev.payload ?? {};
  const pr = payload.pull_request as { title?: string } | undefined;
  const issue = payload.issue as { title?: string } | undefined;
  return {
    event_id: ev.id,
    event_type: ev.type,
    actor_login: ev.actor?.login ?? "",
    actor_avatar: ev.actor?.avatar_url ?? "",
    repo_name: repoName,
    owner: repoName.split("/")[0],
    created_at: chDateTime(ev.created_at),
    action: typeof payload.action === "string" ? payload.action : "",
    ref_type: typeof payload.ref_type === "string" ? payload.ref_type : "",
    number: typeof payload.number === "number" ? payload.number : 0,
    title:
      ev.type === "PullRequestEvent"
        ? pr?.title ?? null
        : ev.type === "IssuesEvent"
          ? issue?.title ?? null
          : null,
    payload: JSON.stringify(payload),
  };
}

async function upsertEtag(repoName: string, etag: string) {
  await clickhouseInsert.insert({
    table: ETAG_TABLE,
    values: [{ repo_name: repoName, etag, updated_at: chDateTime(new Date().toISOString()) }],
    format: "JSONEachRow",
  });
}

async function pollRepo(repoName: string): Promise<{ inserted: number; status: number }> {
  const state = await repoState(repoName);
  if (!state) return { inserted: 0, status: 0 };
  const { etag, maxEventId } = state;

  const headers: Record<string, string> = { ...(authHeaders() as Record<string, string>) };
  if (etag) headers["if-none-match"] = etag;

  const res = await fetch(`${API_BASE}/repos/${repoName}/events?per_page=${PER_PAGE}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  // Always advance the rotation cursor, including on 304/404 — a stale
  // updated_at would pin the repo to the front of the rotation forever.
  const newEtag = res.headers.get("etag") ?? etag;
  if (res.status === 304) {
    await upsertEtag(repoName, newEtag);
    return { inserted: 0, status: 304 };
  }
  if (res.status === 404) {
    logger.log("Repo events endpoint 404 (renamed, private, or deleted)", { repoName });
    await upsertEtag(repoName, newEtag);
    return { inserted: 0, status: 404 };
  }
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    logger.log("Rate limited by GitHub Events API", { repoName, reset });
    throw new Error(`rate-limited (reset=${reset})`);
  }
  if (!res.ok) {
    logger.log("Events API error", { repoName, status: res.status });
    await upsertEtag(repoName, newEtag);
    return { inserted: 0, status: res.status };
  }

  const events = (await res.json()) as ApiEvent[];
  const watermark = BigInt(maxEventId || "0");
  const rows = events
    .filter((ev) => {
      try {
        return BigInt(ev.id) > watermark;
      } catch {
        return false;
      }
    })
    .map(toRow)
    .filter((r): r is StreamRow => r !== null);

  if (rows.length > 0) {
    await clickhouseInsert.insert({ table: STREAM_TABLE, values: rows, format: "JSONEachRow" });
  }
  await upsertEtag(repoName, newEtag);
  return { inserted: rows.length, status: 200 };
}

export const pollRepoEvents = schedules.task({
  id: "poll-repo-events",
  cron: "*/1 * * * *",
  maxDuration: MAX_DURATION_SECONDS,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    if (!process.env.GITHUB_TOKEN) {
      logger.log("GITHUB_TOKEN is not set — events poller cannot run (60/hr unauthenticated limit is too small for the watchlist)");
      metadata.set("poll", { source: "events-api", inserted: 0, error: "no GITHUB_TOKEN" });
      return { inserted: 0, error: "no GITHUB_TOKEN" };
    }

    const deadlineMs = Date.now() + MAX_DURATION_SECONDS * 1000 - RUN_DEADLINE_BUFFER_MS;
    const repos = await pickRepos();
    if (repos.length === 0) {
      logger.log("Watchlist is empty — nothing to poll");
      metadata.set("poll", { source: "events-api", inserted: 0, candidates: 0 });
      return { inserted: 0, candidates: 0 };
    }

    let inserted = 0;
    let polled = 0;
    let rateLimited = false;
    // Small bounded concurrency: 4 parallel fetches keeps a run under ~10s.
    for (let i = 0; i < repos.length; i += FETCH_CONCURRENCY) {
      if (Date.now() > deadlineMs || rateLimited) break;
      const batch = repos.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((r) => pollRepo(r)));
      for (const result of results) {
        if (result.status === "fulfilled") {
          inserted += result.value.inserted;
          polled += 1;
        } else if (result.reason instanceof Error && result.reason.message.startsWith("rate-limited")) {
          rateLimited = true;
        } else {
          logger.log("Poll failed for repo", { error: String(result.reason) });
        }
      }
    }

    metadata.set("poll", { source: "events-api", inserted, polled, candidates: repos.length, rateLimited });
    logger.log("Events API poll complete", { inserted, polled, candidates: repos.length, rateLimited });
    return { inserted, polled, candidates: repos.length, rateLimited };
  },
});
