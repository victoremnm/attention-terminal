# ClickHouse graph query examples

The Attention Terminal schema already treats Hacker News stories, GitHub repos,
and HuggingFace models as documents in `mart_attention_documents`. On top of
that, the raw event tables let us mine relationship graphs directly in
ClickHouse SQL.

This page shows the three graph topologies now exposed through the analyst
agent and how to run them by hand.

---

## 1. Topic co-occurrence in HN titles

Which technology topics are discussed in the same Hacker News story?

```sql
WITH
  hits AS (
    SELECT
      [ if(hasToken(lower(title), 'rust'), 'rust', NULL),
        if(hasToken(lower(title), 'postgres') OR hasToken(lower(title), 'postgresql'), 'postgres', NULL),
        if(hasToken(lower(title), 'react'), 'react', NULL),
        if(hasToken(lower(title), 'nextjs') OR hasToken(lower(title), 'next'), 'nextjs', NULL),
        if(hasToken(lower(title), 'clickhouse'), 'clickhouse', NULL) ] AS topic_hits
    FROM hackernews
    WHERE type = 'story'
      AND deleted = 0
      AND dead = 0
      AND time >= (SELECT max(time) FROM hackernews) - INTERVAL 7 DAY
      AND length(title) > 0
  )
SELECT
  a.1 AS source,
  a.2 AS target,
  count() AS weight
FROM hits
ARRAY JOIN arrayEnumerateUnordered(topic_hits, 2) AS a
WHERE a.1 IS NOT NULL AND a.2 IS NOT NULL AND a.1 < a.2
GROUP BY source, target
ORDER BY weight DESC
LIMIT 20;
```

**What it mines:** implicit associations. If "Rust" and "Postgres" co-occur
repeatedly, there is likely a conversation cluster around Rust databases or
Postgres extensions written in Rust.

---

## 2. Repository ecosystem via shared actors

Which GitHub repositories share contributors in the current window?

```sql
WITH
  active_repos AS (
    SELECT repo_name
    FROM github_events
    WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 7 DAY
      AND actor_login != ''
    GROUP BY repo_name
    ORDER BY count() DESC
    LIMIT 50
  ),
  actor_repos AS (
    SELECT actor_login, groupUniqArray(repo_name) AS repos
    FROM github_events
    WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 7 DAY
      AND actor_login != ''
      AND repo_name IN (SELECT repo_name FROM active_repos)
    GROUP BY actor_login
    HAVING length(repos) > 1
  )
SELECT
  a.1 AS source_repo,
  a.2 AS target_repo,
  count() AS shared_actors
FROM actor_repos
ARRAY JOIN arrayEnumerateUnordered(repos, 2) AS a
WHERE a.1 < a.2
GROUP BY source_repo, target_repo
ORDER BY shared_actors DESC
LIMIT 20;
```

**What it mines:** project ecosystems. A strong edge between two repos means
the same people are shipping code in both, which is a stronger signal of
ecosystem coupling than keyword overlap.

---

## 3. Topic ↔ repository keyword bridge

Which conversations on HN are tied to which code communities by shared
keywords?

```sql
WITH
  story_topics AS (
    SELECT
      id,
      title,
      arrayFilter(x -> x IS NOT NULL, [
        if(hasToken(lower(title), 'rust'), 'rust', NULL),
        if(hasToken(lower(title), 'postgres') OR hasToken(lower(title), 'postgresql'), 'postgres', NULL),
        if(hasToken(lower(title), 'clickhouse'), 'clickhouse', NULL)
      ]) AS topics
    FROM hackernews
    WHERE type = 'story'
      AND deleted = 0
      AND dead = 0
      AND time >= (SELECT max(time) FROM hackernews) - INTERVAL 7 DAY
      AND length(title) > 0
  ),
  repo_topics AS (
    SELECT
      repo_name,
      arrayFilter(x -> x IS NOT NULL, [
        if(match(lower(repo_name), '(rust)'), 'rust', NULL),
        if(match(lower(repo_name), '(postgres|postgresql)'), 'postgres', NULL),
        if(match(lower(repo_name), '(clickhouse)'), 'clickhouse', NULL)
      ]) AS topics
    FROM github_events
    WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 7 DAY
      AND repo_name != ''
    GROUP BY repo_name
    HAVING length(topics) > 0
  )
SELECT
  st.topic AS topic,
  rt.repo_name AS repo,
  count() AS weight
FROM story_topics st
ARRAY JOIN st.topics AS topic
CROSS JOIN repo_topics rt
ARRAY JOIN rt.topics AS rt_topic
WHERE st.topic = rt_topic
GROUP BY topic, repo
ORDER BY weight DESC
LIMIT 30;
```

**What it mines:** talk-vs-code bridges. It surfaces repos whose names or
communities directly overlap with HN conversation topics.

---

## 4. Fast token trend scan

Because `hackernews` has a `tokenbf_v1` index on `lower(title)`, arbitrary
keyword scans stay fast even over tens of millions of rows:

```sql
SELECT toDate(time) AS day, count() AS stories, sum(score) AS points
FROM hackernews FINAL
WHERE type = 'story'
  AND deleted = 0
  AND dead = 0
  AND hasToken(lower(title), 'clickhouse')
  AND time >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day;
```

---

## Using these from the agent

The analyst agent now has a `getTopicGraph` tool. Ask it things like:

- "Show me the topic co-occurrence graph for the last week."
- "Which repos share contributors right now?"
- "Graph the bridge between HN topics and GitHub repos."

The agent returns a `graph` render payload that the UI draws as an SVG
force-directed network.
