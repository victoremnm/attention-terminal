// ClickHouse graph queries for relationship mining across Attention Terminal data.
// These return node/edge structures that can be rendered as network diagrams.

import { q } from "./queries";

export interface GraphNode {
  id: string;
  label: string;
  group: "topic" | "repo" | "story" | "actor" | "model";
  value: number;
  meta?: Record<string, number | string>;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  kind: "cooccurrence" | "shared_actor" | "shared_keyword" | "citation";
}

export interface AttentionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Hardcoded topic dictionary kept in sync with src/lib/digest.ts so graph queries
// can map free-text tokens to stable topic nodes.
const TOPICS = [
  { key: "postgres", label: "Postgres", tokens: ["postgres", "postgresql", "pg"] },
  { key: "sqlite", label: "SQLite", tokens: ["sqlite"] },
  { key: "clickhouse", label: "ClickHouse", tokens: ["clickhouse"] },
  { key: "bun", label: "Bun", tokens: ["bun", "oven"] },
  { key: "deno", label: "Deno", tokens: ["deno"] },
  { key: "rust", label: "Rust", tokens: ["rust"] },
  { key: "react", label: "React", tokens: ["react"] },
  { key: "nextjs", label: "Next.js", tokens: ["nextjs", "next"] },
  { key: "tailwind", label: "Tailwind CSS", tokens: ["tailwind"] },
  { key: "llama", label: "Llama", tokens: ["llama"] },
  { key: "qwen", label: "Qwen", tokens: ["qwen"] },
  { key: "graphify", label: "Graphify", tokens: ["graphify"] },
  { key: "attention-terminal", label: "Attention Terminal", tokens: ["attention", "terminal"] },
] as const;

type Topic = (typeof TOPICS)[number];

function tokenWhere(topic: Topic) {
  return topic.tokens.map((token) => `hasToken(lower(title), '${token.replaceAll("'", "''")}')`).join(" OR ");
}

/**
 * Topic co-occurrence graph from Hacker News titles.
 *
 * For each story in the lookback window, we detect which known topics appear in
 * the title. Topic pairs that appear in the same story form an edge weighted by
 * how often they co-occur. Node size reflects total mention volume.
 *
 * This reveals which technologies are discussed together, e.g. "Rust" + "Postgres"
 * vs "React" + "Next.js".
 */
export async function topicCooccurrenceGraph(hours = 168, minWeight = 2): Promise<AttentionGraph> {
  const topicSelects = TOPICS.map((t) => `if((${tokenWhere(t)}), '${t.key}', NULL) AS ${t.key}_hit`).join(", ");

  const { rows: edgeRows } = await q<{ source: string; target: string; weight: string }>(
    `WITH
      hits AS (
        SELECT [${topicSelects}] AS topic_hits
        FROM hackernews
        WHERE type = 'story'
          AND deleted = 0
          AND dead = 0
          AND time >= (SELECT max(time) FROM hackernews) - INTERVAL ${hours} HOUR
          AND length(title) > 0
      ),
      cooccurrences AS (
        SELECT
          a.1 AS source,
          a.2 AS target,
          count() AS weight
        FROM hits
        ARRAY JOIN arrayEnumerateUnordered(topic_hits, 2) AS a
        WHERE a.1 IS NOT NULL
          AND a.2 IS NOT NULL
          AND a.1 < a.2
        GROUP BY source, target
        HAVING weight >= ${minWeight}
        ORDER BY weight DESC
        LIMIT 100
      )
    SELECT source, target, toUInt32(weight) AS weight FROM cooccurrences`,
    ["hackernews"]
  );

  const { rows: nodeRows } = await q<{ topic: string; volume: string }>(
    `WITH
      hits AS (
        SELECT [${topicSelects}] AS topic_hits
        FROM hackernews
        WHERE type = 'story'
          AND deleted = 0
          AND dead = 0
          AND time >= (SELECT max(time) FROM hackernews) - INTERVAL ${hours} HOUR
          AND length(title) > 0
      )
    SELECT
      arrayJoin(topic_hits) AS topic,
      toUInt32(count()) AS volume
    FROM hits
    ARRAY JOIN topic_hits
    WHERE topic IS NOT NULL
    GROUP BY topic
    ORDER BY volume DESC`,
    ["hackernews"]
  );

  const topicByKey = new Map<string, Topic>(TOPICS.map((t) => [t.key, t]));
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const row of edgeRows) {
    edges.push({
      source: row.source,
      target: row.target,
      weight: Number(row.weight),
      kind: "cooccurrence",
    });
    nodeIds.add(row.source);
    nodeIds.add(row.target);
  }

  const nodes: GraphNode[] = nodeRows
    .filter((row) => nodeIds.has(row.topic))
    .map((row) => {
      const topic = topicByKey.get(row.topic);
      return {
        id: row.topic,
        label: topic?.label ?? row.topic,
        group: "topic",
        value: Number(row.volume),
      };
    });

  return { nodes, edges };
}

/**
 * GitHub repository similarity graph based on shared actors.
 *
 * Two repos are linked when the same GitHub login contributes to both within the
 * lookback window. Edge weight is the number of shared unique actors. Node size
 * is the repo's total event volume. This surfaces project ecosystems and
 * communities that move together.
 */
export async function repoSharedActorGraph(hours = 168, minShared = 3, topRepos = 50): Promise<AttentionGraph> {
  const { rows: edgeRows } = await q<{ source: string; target: string; weight: string }>(
    `WITH
      active_repos AS (
        SELECT repo_name
        FROM github_events
        WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL ${hours} HOUR
          AND actor_login != ''
        GROUP BY repo_name
        ORDER BY count() DESC
        LIMIT ${topRepos}
      ),
      actor_repos AS (
        SELECT actor_login, groupUniqArray(repo_name) AS repos
        FROM github_events
        WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL ${hours} HOUR
          AND actor_login != ''
          AND repo_name IN (SELECT repo_name FROM active_repos)
        GROUP BY actor_login
        HAVING length(repos) > 1
      ),
      pairs AS (
        SELECT
          a.1 AS source,
          a.2 AS target,
          count() AS weight
        FROM actor_repos
        ARRAY JOIN arrayEnumerateUnordered(repos, 2) AS a
        WHERE a.1 < a.2
        GROUP BY source, target
        HAVING weight >= ${minShared}
        ORDER BY weight DESC
        LIMIT 150
      )
    SELECT source, target, toUInt32(weight) AS weight FROM pairs`,
    ["github_events"]
  );

  const { rows: nodeRows } = await q<{ repo_name: string; events: string }>(
    `SELECT repo_name, toUInt32(count()) AS events
     FROM github_events
     WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL ${hours} HOUR
       AND actor_login != ''
       AND repo_name IN (
         SELECT repo_name
         FROM github_events
         WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL ${hours} HOUR
           AND actor_login != ''
         GROUP BY repo_name
         ORDER BY count() DESC
         LIMIT ${topRepos}
       )
     GROUP BY repo_name
     ORDER BY events DESC`,
    ["github_events"]
  );

  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const row of edgeRows) {
    edges.push({
      source: row.source,
      target: row.target,
      weight: Number(row.weight),
      kind: "shared_actor",
    });
    nodeIds.add(row.source);
    nodeIds.add(row.target);
  }

  const nodes: GraphNode[] = nodeRows
    .filter((row) => nodeIds.has(row.repo_name))
    .map((row) => ({
      id: row.repo_name,
      label: row.repo_name.split("/").pop() ?? row.repo_name,
      group: "repo",
      value: Number(row.events),
      meta: { full_name: row.repo_name },
    }));

  return { nodes, edges };
}

/**
 * Cross-source bridge graph: topics linked to repos when the repo name or its
 * recent activity overlaps with topic tokens in Hacker News stories.
 *
 * This creates a bipartite-style graph showing which code communities are
 * driving which conversations.
 */
export async function topicRepoBridgeGraph(hours = 168, topPairs = 50): Promise<AttentionGraph> {
  const topicSelects = TOPICS.map(
    (t) => `if((${tokenWhere(t)}), '${t.key}', NULL) AS ${t.key}_hit`
  ).join(", ");

  const repoTopicExprs = TOPICS.map(
    (t) =>
      `if(match(lower(repo_name), '(${t.tokens.map((tok) => tok.replaceAll("'", "''")).join("|")})'), '${t.key}', NULL)`
  ).join(", ");

  const { rows: edgeRows } = await q<{ source: string; target: string; weight: string }>(
    `WITH
      story_topics AS (
        SELECT
          id,
          title,
          arrayFilter(x -> x IS NOT NULL, [${topicSelects}]) AS topics
        FROM hackernews
        WHERE type = 'story'
          AND deleted = 0
          AND dead = 0
          AND time >= (SELECT max(time) FROM hackernews) - INTERVAL ${hours} HOUR
          AND length(title) > 0
      ),
      repo_tokens AS (
        SELECT
          repo_name,
          arrayFilter(x -> x IS NOT NULL, [${repoTopicExprs}]) AS topics
        FROM github_events
        WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL ${hours} HOUR
          AND repo_name != ''
        GROUP BY repo_name
        HAVING length(topics) > 0
      ),
      edges AS (
        SELECT
          st.topic AS source,
          rt.repo_name AS target,
          toUInt32(count()) AS weight
        FROM story_topics st
        ARRAY JOIN st.topics AS topic
        CROSS JOIN repo_tokens rt
        ARRAY JOIN rt.topics AS rt_topic
        WHERE st.topic = rt_topic
        GROUP BY source, target
        ORDER BY weight DESC
        LIMIT ${topPairs}
      )
    SELECT source, target, weight FROM edges`,
    ["hackernews", "github_events"]
  );

  const topicByKey = new Map<string, Topic>(TOPICS.map((t) => [t.key, t]));
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const row of edgeRows) {
    edges.push({
      source: row.source,
      target: row.target,
      weight: Number(row.weight),
      kind: "shared_keyword",
    });
    nodeIds.add(row.source);
    nodeIds.add(row.target);
  }

  const topicNodes: GraphNode[] = TOPICS.filter((t) => nodeIds.has(t.key)).map((t) => ({
    id: t.key,
    label: t.label,
    group: "topic",
    value: 1,
  }));

  const repoNodeIds = [...nodeIds].filter((id) => !topicByKey.has(id));
  const repoNodes: GraphNode[] = repoNodeIds.map((id) => ({
    id,
    label: id.split("/").pop() ?? id,
    group: "repo",
    value: 1,
    meta: { full_name: id },
  }));

  return { nodes: [...topicNodes, ...repoNodes], edges };
}
