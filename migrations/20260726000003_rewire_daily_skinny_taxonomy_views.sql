-- +goose Up
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_hn_hourly_mv TO daily_skinny_subject_hourly AS
SELECT
    toStartOfHour(h.time) AS hour,
    t.display_name AS subject,
    'hn' AS source,
    count() AS talk_threads,
    sum(greatest(h.descendants, 0)) AS comments,
    0 AS code_score,
    0 AS gh_stars,
    uniqState('') AS repos
FROM hackernews h
CROSS JOIN curated.daily_skinny_taxonomy t
WHERE h.type = 'story'
  AND h.deleted = 0
  AND h.dead = 0
  AND arrayExists(tok -> hasToken(lower(h.title), tok), t.hn_tokens)
GROUP BY hour, subject;

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_gh_hourly_mv TO daily_skinny_subject_hourly AS
SELECT
    toStartOfHour(g.created_at) AS hour,
    t.display_name AS subject,
    'gh' AS source,
    0 AS talk_threads,
    0 AS comments,
    sum(g.commit_count + (g.event_type = 'PullRequestEvent' AND g.action = 'opened') * 3 + (g.event_type = 'PullRequestEvent' AND g.action = 'closed' AND g.pr_merged = 1) * 5 + (g.event_type = 'IssuesEvent' AND g.action = 'opened') * 2 + (g.event_type = 'WatchEvent') * 2) AS code_score,
    countIf(g.event_type = 'WatchEvent') AS gh_stars,
    uniqState(g.repo_name) AS repos
FROM github_events g
CROSS JOIN curated.daily_skinny_taxonomy t
WHERE arrayExists(pat -> lower(g.repo_name) LIKE pat, t.gh_repo_patterns)
GROUP BY hour, subject;

-- +goose Down
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
