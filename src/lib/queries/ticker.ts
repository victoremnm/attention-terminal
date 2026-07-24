import { unstable_cache } from "next/cache";
import { actorLeaderboard } from "./actor";
import { q, stat, valueOf } from "./core";
import type { TickerLanes } from "./types";

async function assembleTickerLanes(): Promise<TickerLanes> {
  const [repos, forks, shipping, stars, stories, actors] = await Promise.all([
    q<{ name: string; at: string; spark: number[] }>(
      `SELECT repo_name AS name, max(h) AS at,
              groupArray(6)(cnt) AS spark
       FROM (
         SELECT repo_name, toStartOfHour(created_at) AS h, count() AS cnt
         FROM raw.github_events
         WHERE event_type = 'CreateEvent'
           AND ref_type = 'repository'
           AND created_at > (SELECT max(created_at) FROM raw.github_events) - INTERVAL 6 HOUR
         GROUP BY repo_name, h ORDER BY repo_name, h
       ) GROUP BY repo_name ORDER BY at DESC LIMIT 20`,
      ["raw.github_events"]
    ),
    q<{ name: string; forks: string; stars: string; pushes: string; prs: string; issues: string; spark: number[] }>(
      `WITH
         (SELECT max(hour) FROM gh_repo_hourly) AS max_h,
         per_repo_event AS (
           SELECT repo_name, event_type, countMerge(events) AS event_count
           FROM gh_repo_hourly
           WHERE hour > max_h - INTERVAL 24 HOUR
             AND event_type IN ('ForkEvent', 'WatchEvent', 'PushEvent', 'PullRequestEvent', 'IssuesEvent')
           GROUP BY repo_name, event_type
         ),
         per_repo AS (
           SELECT repo_name,
                  sumIf(event_count, event_type = 'ForkEvent') AS fork_count,
                  sumIf(event_count, event_type = 'WatchEvent') AS star_count,
                  sumIf(event_count, event_type = 'PushEvent') AS push_count,
                  sumIf(event_count, event_type = 'PullRequestEvent') AS pr_count,
                  sumIf(event_count, event_type = 'IssuesEvent') AS issue_count
           FROM per_repo_event
           GROUP BY repo_name
           HAVING fork_count > 0 AND push_count + pr_count + issue_count > 0
         ),
         fork_spark AS (
            SELECT repo_name, reverse(groupArray(8)(cnt)) AS spark
            FROM (
              SELECT repo_name, hour, countMerge(events) AS cnt
              FROM gh_repo_hourly
              WHERE hour > max_h - INTERVAL 24 HOUR
                AND event_type = 'ForkEvent'
              GROUP BY repo_name, hour
              ORDER BY repo_name, hour DESC
            ) GROUP BY repo_name
         )
         SELECT p.repo_name AS name,
                toString(p.fork_count) AS forks,
                toString(p.star_count) AS stars,
                toString(p.push_count) AS pushes,
              toString(p.pr_count) AS prs,
              toString(p.issue_count) AS issues,
              fs.spark
       FROM per_repo p
       LEFT JOIN fork_spark fs ON p.repo_name = fs.repo_name
       ORDER BY p.pr_count * 5 + p.issue_count * 3 + p.push_count * 2 + least(p.fork_count, 20) DESC,
                p.fork_count DESC
       LIMIT 20`,
      ["gh_repo_hourly"]
    ),
    q<{
      name: string;
      commit_total: string;
      push_count: string;
      pr_count: string;
      closed_pr_count: string;
      issue_count: string;
      fork_count: string;
      actor_count: string;
      events: string;
      spark: number[];
    }>(
      `WITH
         (SELECT max(created_at) FROM gh_repo_activity_feed) AS max_time
       SELECT repo_name AS name,
              sum(commits) AS commit_total,
              countIf(event_type = 'PushEvent') AS push_count,
              countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS pr_count,
              countIf(event_type = 'PullRequestEvent' AND action = 'closed') AS closed_pr_count,
              countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issue_count,
              countIf(event_type = 'ForkEvent') AS fork_count,
              uniqExactIf(actor_login, event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')) AS actor_count,
              sum(commits) + countIf(event_type = 'PushEvent')
                + countIf(event_type = 'PullRequestEvent' AND action = 'opened')
                + countIf(event_type = 'PullRequestEvent' AND action = 'closed')
                + countIf(event_type = 'IssuesEvent' AND action = 'opened') AS events,
              [] AS spark
       FROM gh_repo_activity_feed
       WHERE created_at > max_time - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent', 'ForkEvent')
         AND lower(actor_login) NOT LIKE '%[bot]%'
       GROUP BY repo_name
       HAVING commit_total > 0 OR pr_count > 0 OR closed_pr_count > 0
       ORDER BY commit_total * 4 + closed_pr_count * 5 + pr_count * 3
                + least(push_count, commit_total) * 2 + actor_count * 2 DESC,
                commit_total DESC
       LIMIT 20`,
      ["gh_repo_activity_feed"]
    ),
    q<{ name: string; stars: string; surge: number; spark: number[] }>(
      `WITH recent AS (
          SELECT repo_name, sum(cnt) AS star_total,
                 reverse(groupArray(8)(cnt)) AS spark
          FROM (
            SELECT repo_name, toStartOfHour(hour) AS h, countMerge(events) AS cnt
            FROM gh_repo_hourly
            WHERE event_type = 'WatchEvent'
              AND hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR
            GROUP BY repo_name, h ORDER BY repo_name, h DESC
          ) GROUP BY repo_name
       ),
       base AS (
         SELECT repo_name, sum(cnt) / 29 AS daily_avg
         FROM (
           SELECT repo_name, toDate(hour) AS day, countMerge(events) AS cnt
           FROM gh_repo_hourly
           WHERE event_type = 'WatchEvent'
             AND hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 30 DAY
             AND hour <= (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR
           GROUP BY repo_name, day
         )
         GROUP BY repo_name
       )
       SELECT r.repo_name AS name,
              toString(r.star_total) AS stars,
              round(r.star_total / greatest(any(b.daily_avg), 0.5), 1) AS surge,
              r.spark AS spark
       FROM recent r LEFT ANY JOIN base b ON r.repo_name = b.repo_name
       GROUP BY r.repo_name, r.star_total, r.spark
       ORDER BY r.star_total DESC LIMIT 20`,
      ["gh_repo_hourly"]
    ),
    q<{ id: number; name: string; score: number; velocity: number }>(
      `SELECT id, title AS name, score,
              round(score / greatest((now() - time) / 3600, 0.5), 1) AS velocity
       FROM raw.hackernews FINAL
       WHERE type = 'story' AND time > now() - INTERVAL 6 HOUR
         AND score >= 10 AND deleted = 0 AND dead = 0
       ORDER BY velocity DESC LIMIT 20`,
      ["raw.hackernews"]
    ),
    actorLeaderboard("24h").catch(() => undefined),
  ]);

  return {
    newRepos: repos.rows.map((r) => ({
      kicker: "NEW REPO",
      name: r.name,
      metric: "born " + r.at.slice(11, 16) + " UTC",
      spark: r.spark,
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    topForked: forks.rows.map((r) => ({
      kicker: "FORKED 24H",
      name: r.name,
      metric: `+${r.forks} new forks`,
      spark: r.spark,
      stats: [
        stat("stars", r.stars, "hot"),
        stat("pushes", r.pushes),
        stat("PRs", r.prs),
        stat("issues", r.issues),
      ],
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    shippingVelocity: shipping.rows.map((r) => {
      const commits = valueOf(r.commit_total);
      const pushes = valueOf(r.push_count);
      const metricIsPushes = commits === 0 && pushes > 0;
      const metric = commits > 0 ? `${r.commit_total} commits` : pushes > 0 ? `${r.push_count} pushes` : `${r.events} events`;
      return {
        kicker: "SHIPPING",
        name: r.name,
        metric,
        spark: r.spark,
        stats: [
          ...(metricIsPushes ? [] : [stat("pushes", r.push_count, pushes > 0 ? "hot" : "muted")]),
          stat("PRs", r.pr_count),
          stat("closed", r.closed_pr_count),
          stat("issues", r.issue_count),
          stat("forks", r.fork_count),
          stat("actors", r.actor_count, "hot"),
        ],
        href: `https://github.com/${r.name}`,
        repoName: r.name,
      };
    }),
    starBreakouts: stars.rows.map((r) => ({
      kicker: "STARS 24H",
      name: r.name,
      metric: `+${r.stars} stars`,
      delta: `x${r.surge} vs 30d avg`,
      spark: r.spark,
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    risingStories: stories.rows.map((r) => ({
      kicker: "RISING",
      name: r.name,
      metric: `${r.velocity} pts/hr`,
      delta: `${r.score} pts`,
      href: `https://news.ycombinator.com/item?id=${r.id}`,
    })),
    actors: actors ?? { humans: [], bots: [], provenance: [] },
    provenance: [repos.provenance, forks.provenance, shipping.provenance, stars.provenance, stories.provenance],
    fetchedAt: new Date().toISOString(),
  };
}

const cachedTickerLanes = unstable_cache(assembleTickerLanes, ["ticker-lanes"], {
  revalidate: 60,
});

export async function tickerLanes(): Promise<TickerLanes> {
  if (process.env.NODE_ENV === "test") return assembleTickerLanes();
  return cachedTickerLanes();
}
