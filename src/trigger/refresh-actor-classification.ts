import { logger, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";
import { classificationJoin, isBotFilter } from "../lib/actor-classification";

// Actor classification dimension refresh (issue #200).
// Picks distinct actors from raw.github_events (last 7d) that haven't been
// classified yet or whose classification is stale (>3 days), then fetches
// their real account type from the GitHub API (User vs Bot vs Organization).
// Actors whose login contains [bot] brackets are auto-classified as Bot
// without an API call. Core REST API rate limit is 5000 req/hr auth'd;
// MAX_ACTORS_PER_RUN=100 stays well under even with retries (2% of quota).
const FETCH_CONCURRENCY = 5;
const MAX_ACTORS_PER_RUN = 100;
const STALE_DAYS = 3;

interface CandidateRow {
  actor_login: string;
}

interface OctokitResponse {
  login: string;
  type: "User" | "Bot" | "Organization";
  id: number;
}

async function fetchActorType(login: string): Promise<"User" | "Bot" | "Organization" | null> {
  if (!process.env.GITHUB_TOKEN) {
    logger.warn("[refreshActorClassification] GITHUB_TOKEN unset — classifying bracket-logins only");
    return null;
  }
  try {
    const url = `https://api.github.com/users/${encodeURIComponent(login)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "attention-terminal",
      },
    });
    if (response.status === 403) {
      const resetEpoch = response.headers.get("x-ratelimit-reset");
      logger.warn("[refreshActorClassification] rate-limited", { login, resetEpoch });
      return null;
    }
    if (response.status === 404) {
      logger.info("[refreshActorClassification] actor not found on GitHub", { login });
      return null;
    }
    if (!response.ok) {
      logger.warn("[refreshActorClassification] GitHub API error", { login, status: response.status });
      return null;
    }
    const data = (await response.json()) as OctokitResponse;
    if (data.type !== "User" && data.type !== "Bot" && data.type !== "Organization") {
      return null;
    }
    return data.type;
  } catch (error) {
    logger.warn("[refreshActorClassification] fetch failed", { login, error });
    return null;
  }
}

export const refreshActorClassification = schedules.task({
  id: "refresh-actor-classification",
  // Every hour during the active ingestion window; runs on Trigger.dev cron.
  cron: "0 * * * *",
  maxDuration: 300,
  run: async () => {
    logger.log("[refreshActorClassification] starting classification refresh");

    const candidates = await selectRows<CandidateRow>(
      `WITH recent AS (
         SELECT DISTINCT actor_login
         FROM raw.github_events
         WHERE created_at > now() - INTERVAL 7 DAY
           AND actor_login != ''
       ),
       stale AS (
         SELECT actor_login
         FROM recent
         WHERE actor_login NOT IN (
           SELECT actor_login FROM gh_actor_classification
           WHERE fetched_at > now() - INTERVAL ${STALE_DAYS} DAY
         )
       )
       SELECT actor_login FROM stale
       ORDER BY actor_login
       LIMIT ${MAX_ACTORS_PER_RUN}`
    );

    if (candidates.length === 0) {
      logger.log("[refreshActorClassification] no stale candidates — nothing to do");
      return { classified: 0 };
    }

    logger.log("[refreshActorClassification] candidates to classify", {
      count: candidates.length,
    });

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const rows: Array<{ actor_login: string; actor_type: string; fetched_at: string }> = [];
    let apiCalls = 0;

    for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
      const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (c: CandidateRow) => {
          if (/\[bot\]/.test(c.actor_login)) {
            return { actor_login: c.actor_login, actor_type: "Bot" as const };
          }
          apiCalls++;
          const actorType = await fetchActorType(c.actor_login);
          if (!actorType) return null;
          return { actor_login: c.actor_login, actor_type: actorType };
        })
      );
      for (const r of results) {
        if (!r) continue;
        rows.push({ actor_login: r.actor_login, actor_type: r.actor_type, fetched_at: now });
      }
    }

    await clickhouseInsert.insert({
      table: "gh_actor_classification",
      values: rows,
      format: "JSONEachRow",
    });

    logger.log("[refreshActorClassification] done", {
      classified: rows.length,
      apiCalls,
    });

    return { classified: rows.length, apiCalls };
  },
});
