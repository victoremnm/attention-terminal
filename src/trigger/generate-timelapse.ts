// Deterministic repo timelapse generator.
//
// Rebuilds per-repo, per-hour commentary windows from the event stream every
// hour. Zero LLM cost: themes and narrative are derived from event patterns
// (type x action x volume x actor diversity) with fixed rules, so the output
// is replayable and comparable across runs. Late-arriving GH Archive rows
// refine a window on the next run — curated.repo_timelapse is a
// ReplacingMergeTree(generated_at), so regenerating an hour replaces the
// prior commentary for it.

import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";
import { chDateTime } from "../lib/github-repo";

const MAX_REPOS_PER_RUN = 150;
const WINDOW_HOURS = 24;
const MAX_DURATION_SECONDS = 300;
const RUN_DEADLINE_BUFFER_MS = 30_000;

const STREAM_TABLE = "default.github_events_stream";
const TIMELAPSE_TABLE = "curated.repo_timelapse";

interface EventRow {
  hour: string;
  event_type: string;
  action: string;
  actor_login: string;
  title: string | null;
  number: string;
  cnt: string;
}

interface HourBucket {
  hour: string;
  total: number;
  actors: Set<string>;
  pushes: number;
  stars: number;
  forks: number;
  branchesCreated: number;
  branchesDeleted: number;
  prsOpened: Array<{ number: string; title: string | null }>;
  prsClosed: Array<{ number: string; title: string | null }>;
  issuesOpened: Array<{ number: string; title: string | null }>;
  issuesClosed: Array<{ number: string; title: string | null }>;
  releases: Array<{ title: string | null }>;
}

interface TimelapseRow {
  repo_name: string;
  window_start: string;
  window_end: string;
  commentary: string;
  themes: string[];
  event_count: number;
  key_events: string[];
  generated_at: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function bucketize(rows: EventRow[]): HourBucket[] {
  const buckets = new Map<string, HourBucket>();
  for (const row of rows) {
    const cnt = Number(row.cnt);
    if (!Number.isFinite(cnt) || cnt <= 0) continue;
    let b = buckets.get(row.hour);
    if (!b) {
      b = {
        hour: row.hour,
        total: 0,
        actors: new Set(),
        pushes: 0,
        stars: 0,
        forks: 0,
        branchesCreated: 0,
        branchesDeleted: 0,
        prsOpened: [],
        prsClosed: [],
        issuesOpened: [],
        issuesClosed: [],
        releases: [],
      };
      buckets.set(row.hour, b);
    }
    b.total += cnt;
    if (row.actor_login) b.actors.add(row.actor_login);
    switch (row.event_type) {
      case "PushEvent":
        b.pushes += cnt;
        break;
      case "WatchEvent":
        b.stars += cnt;
        break;
      case "ForkEvent":
        b.forks += cnt;
        break;
      case "PullRequestEvent":
        if (row.action === "opened") b.prsOpened.push({ number: row.number, title: row.title });
        if (row.action === "closed") b.prsClosed.push({ number: row.number, title: row.title });
        break;
      case "IssuesEvent":
        if (row.action === "opened") b.issuesOpened.push({ number: row.number, title: row.title });
        if (row.action === "closed") b.issuesClosed.push({ number: row.number, title: row.title });
        break;
      case "ReleaseEvent":
        b.releases.push({ title: row.title });
        break;
      case "CreateEvent":
        b.branchesCreated += cnt;
        break;
      case "DeleteEvent":
        b.branchesDeleted += cnt;
        break;
    }
  }
  return [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function narrate(b: HourBucket): { commentary: string; themes: string[]; keyEvents: string[] } {
  const themes = new Set<string>();
  const keyEvents: string[] = [];
  const fragments: string[] = [];

  for (const rel of b.releases.slice(0, 2)) {
    themes.add("release");
    const label = rel.title ? `: ${rel.title}` : "";
    keyEvents.push(`Published release${label}`);
    fragments.push(`published a release${label}`);
  }

  if (b.prsOpened.length > 0) {
    themes.add("code-review");
    for (const pr of b.prsOpened.slice(0, 3)) {
      keyEvents.push(`Opened PR #${pr.number}${pr.title ? `: ${pr.title}` : ""}`);
    }
    fragments.push(`opened ${plural(b.prsOpened.length, "PR")}`);
  }
  if (b.prsClosed.length > 0) {
    themes.add("code-review");
    for (const pr of b.prsClosed.slice(0, 3)) {
      keyEvents.push(`Closed PR #${pr.number}${pr.title ? `: ${pr.title}` : ""}`);
    }
    fragments.push(`closed ${plural(b.prsClosed.length, "PR")}`);
  }

  if (b.issuesOpened.length > 0) {
    themes.add("issue-tracking");
    for (const issue of b.issuesOpened.slice(0, 2)) {
      keyEvents.push(`Opened issue #${issue.number}${issue.title ? `: ${issue.title}` : ""}`);
    }
    fragments.push(`opened ${plural(b.issuesOpened.length, "issue")}`);
  }
  if (b.issuesClosed.length > 0) {
    themes.add("issue-resolution");
    fragments.push(`closed ${plural(b.issuesClosed.length, "issue")}`);
  }

  if (b.pushes > 0) {
    if (b.pushes >= 5) themes.add("active-development");
    fragments.push(`${plural(b.pushes, "push")}`);
  }
  if (b.branchesCreated > 0) themes.add("branching");
  if (b.branchesDeleted > 0) themes.add("cleanup");

  if (b.stars >= 3 || b.forks > 0) {
    themes.add("community-growth");
    const community: string[] = [];
    if (b.stars > 0) community.push(plural(b.stars, "new star"));
    if (b.forks > 0) community.push(plural(b.forks, "fork"));
    fragments.push(community.join(" and "));
  }

  if (b.actors.size >= 3) themes.add("collaborative");

  // Commentary: one sentence of activity fragments + one contributor note.
  const activity = fragments.length > 0 ? fragments.join(", ") : `${plural(b.total, "event")}`;
  const contributorNote =
    b.actors.size > 1 ? ` across ${plural(b.actors.size, "contributor")}` : b.actors.size === 1 ? " by 1 contributor" : "";
  const commentary = `${activity.charAt(0).toUpperCase()}${activity.slice(1)}${contributorNote}.`;

  return { commentary, themes: [...themes].sort(), keyEvents: keyEvents.slice(0, 5) };
}

async function engagedRepos(): Promise<string[]> {
  // Only regenerate repos that actually produced events in the window —
  // quiet repos keep their existing commentary rows until TTL.
  const rows = await selectRows<{ repo_name: string }>(
    `SELECT DISTINCT s.repo_name AS repo_name
     FROM ${STREAM_TABLE} AS s
     INNER JOIN watchlist AS w ON w.repo_name = s.repo_name
     WHERE s.created_at >= now() - INTERVAL ${WINDOW_HOURS} HOUR
     ORDER BY s.repo_name ASC
     LIMIT ${MAX_REPOS_PER_RUN}`
  );
  return rows.map((r) => r.repo_name);
}

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function generateForRepo(repoName: string, generatedAt: string): Promise<number> {
  if (!REPO_NAME.test(repoName)) return 0;
  const rows = await selectRows<EventRow>(
    `SELECT
       toString(toStartOfHour(created_at)) AS hour,
       event_type,
       action,
       actor_login,
       title,
       toString(number) AS number,
       toString(count()) AS cnt
     FROM ${STREAM_TABLE}
     WHERE repo_name = '${repoName}'
       AND created_at >= now() - INTERVAL ${WINDOW_HOURS} HOUR
     GROUP BY hour, event_type, action, actor_login, title, number
     ORDER BY hour ASC`
  );

  const buckets = bucketize(rows);
  if (buckets.length === 0) return 0;

  const out: TimelapseRow[] = buckets.map((b) => {
    const { commentary, themes, keyEvents } = narrate(b);
    const start = new Date(b.hour.replace(" ", "T") + "Z");
    const end = new Date(start.getTime() + 3600_000);
    return {
      repo_name: repoName,
      window_start: chDateTime(start.toISOString()),
      window_end: chDateTime(end.toISOString()),
      commentary,
      themes,
      event_count: b.total,
      key_events: keyEvents,
      generated_at: generatedAt,
    };
  });

  await clickhouseInsert.insert({ table: TIMELAPSE_TABLE, values: out, format: "JSONEachRow" });
  return out.length;
}

export const generateTimelapse = schedules.task({
  id: "generate-timelapse",
  cron: "15 * * * *",
  maxDuration: MAX_DURATION_SECONDS,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("timelapse");

    const deadlineMs = Date.now() + MAX_DURATION_SECONDS * 1000 - RUN_DEADLINE_BUFFER_MS;
    const generatedAt = chDateTime(new Date().toISOString());

    const repos = await engagedRepos();
    if (repos.length === 0) {
      metadata.set("timelapse", { repos: 0, windows: 0 });
      return { repos: 0, windows: 0 };
    }

    let windows = 0;
    let processed = 0;
    for (const repo of repos) {
      if (Date.now() > deadlineMs) break;
      try {
        windows += await generateForRepo(repo, generatedAt);
        processed += 1;
      } catch (err) {
        logger.log("Timelapse generation failed for repo", { repo, error: String(err) });
      }
    }

    metadata.set("timelapse", { repos: processed, candidates: repos.length, windows });
    logger.log("Timelapse generation complete", { repos: processed, candidates: repos.length, windows });
    return { repos: processed, candidates: repos.length, windows };
  },
});
