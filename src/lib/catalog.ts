type CatalogEntry = {
  name: string;
  kind: "raw table" | "rollup table" | "dimension table" | "view";
  engine: string;
  schema: string;
  notes: string;
};

const CATALOG: CatalogEntry[] = [
  {
    name: "hackernews",
    kind: "raw table",
    engine: "ReplacingMergeTree(update_time)",
    schema: "raw HN item records; fields used in queries include id, type, time, title, score, by, descendants, deleted, dead",
    notes: "Source for talk-side attention and comment-thread rollups.",
  },
  {
    name: "github_events",
    kind: "raw table",
    engine: "source table",
    schema: "event_id UInt64, event_type String, actor_login String, repo_name String, created_at DateTime, action String, ref_type String, commit_count UInt16, distinct_commit_count UInt16, pr_merged UInt8, number UInt32",
    notes: "Canonical GH Archive firehose used by all GitHub rollups.",
  },
  {
    name: "hf_model_snapshots",
    kind: "raw table",
    engine: "ReplacingMergeTree(ingested_at)",
    schema: "scan_at DateTime, scan_kind LowCardinality(String), model_id String, author String, pipeline_tag LowCardinality(String), library_name LowCardinality(String), tags Array(String), downloads UInt64, likes UInt32, created_at DateTime, last_modified DateTime, is_private UInt8, is_gated UInt8, ingested_at DateTime",
    notes: "Hourly Hugging Face scan snapshots.",
  },
  {
    name: "ingest_log",
    kind: "raw table",
    engine: "MergeTree ORDER BY (source, ingested_at)",
    schema: "source LowCardinality(String), chunk_key String, rows_ingested UInt64, watermark UInt64, ingested_at DateTime",
    notes: "Ingestion watermarks and idempotency log.",
  },
  {
    name: "hn_hourly",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "hour DateTime, type Enum8, items AggregateFunction(count), authors AggregateFunction(uniq, String), score SimpleAggregateFunction(sum, Int64)",
    notes: "Low-latency HN hourly activity rollup.",
  },
  {
    name: "gh_repo_hourly",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "hour DateTime, repo_name String, event_type LowCardinality(String), events AggregateFunction(count), actors AggregateFunction(uniq, String)",
    notes: "Low-latency GitHub repo hourly rollup.",
  },
  {
    name: "daily_skinny_subject_hourly",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "hour DateTime, subject LowCardinality(String), source Enum8('hn' = 1, 'gh' = 2), talk_threads SimpleAggregateFunction(sum, UInt64), comments SimpleAggregateFunction(sum, UInt64), code_score SimpleAggregateFunction(sum, UInt64), gh_stars SimpleAggregateFunction(sum, UInt64), repos AggregateFunction(uniq, String)",
    notes: "Unified subject-level hourly rollup for the Daily Skinny.",
  },
  {
    name: "gh_repo_daily",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "day Date, repo_name String, events AggregateFunction(count), actors AggregateFunction(uniq, String), pushes/commits/distinct_commits/stars/forks/prs_opened/prs_closed/prs_merged/issues_opened/issues_closed/repos_created/branches_created/tags_created/releases_published",
    notes: "Daily repo trend fact table.",
  },
  {
    name: "gh_repo_monthly",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "month Date, repo_name String, same measures as gh_repo_daily",
    notes: "Monthly repo trend fact table.",
  },
  {
    name: "gh_repo_metadata",
    kind: "dimension table",
    engine: "ReplacingMergeTree(fetched_at)",
    schema: "repo_name String, owner String, owner_type LowCardinality(String), description String, language LowCardinality(String), topics Array(String), homepage String, license LowCardinality(String), created_at DateTime, pushed_at DateTime, archived UInt8, fork UInt8, github_stars UInt64, github_forks UInt64, open_issues UInt64, fetched_at DateTime",
    notes: "GitHub REST enrichment for repo drill-downs.",
  },
  {
    name: "gh_repo_activity_feed",
    kind: "view",
    engine: "VIEW over github_events",
    schema: "repo_name, actor_login, created_at, event_type, action, commit_count, distinct_commit_count, pr_merged, number, ref_type",
    notes: "Compatibility feed for repo drill-down / ad-hoc SQL.",
  },
  {
    name: "gh_actor_daily",
    kind: "rollup table",
    engine: "AggregatingMergeTree",
    schema: "day Date, actor_login String, events AggregateFunction(count), repos AggregateFunction(uniq, String), pushes SimpleAggregateFunction(sum, UInt64), commits SimpleAggregateFunction(sum, UInt64), prs_opened SimpleAggregateFunction(sum, UInt64), prs_merged SimpleAggregateFunction(sum, UInt64)",
    notes: "Daily actor activity for DevScatter.",
  },
  {
    name: "gh_actor_pr_stats",
    kind: "dimension table",
    engine: "ReplacingMergeTree(fetched_at)",
    schema: "actor_login String, merged_prs_7d UInt64, merged_prs_30d UInt64, fetched_at DateTime",
    notes: "Merged-PR enrichment for builder attribution.",
  },
  {
    name: "subagent_runs",
    kind: "raw table",
    engine: "ReplacingMergeTree(ts)",
    schema: "ts DateTime64(3), session_id String, prompt_id String, agent_id String, agent_type LowCardinality(String), effort_level LowCardinality(String), permission_mode LowCardinality(String), cwd String, spec_hash String, spec_preview String, result_hash String, result_preview String, latency_ms UInt64, ok UInt8",
    notes: "Sub-agent run telemetry.",
  },
  {
    name: "subagent_api_events",
    kind: "raw table",
    engine: "MergeTree ORDER BY (prompt_id, ts)",
    schema: "ts DateTime64(3), session_id String, prompt_id String, query_source LowCardinality(String), agent_name LowCardinality(String), model LowCardinality(String), input_tokens UInt64, output_tokens UInt64, cache_read_tokens UInt64, cache_creation_tokens UInt64, cost_usd Float64, duration_ms UInt64",
    notes: "OTel-derived token/cost events.",
  },
  {
    name: "subagent_evals",
    kind: "dimension table",
    engine: "ReplacingMergeTree(scored_at)",
    schema: "spec_hash String, result_hash String, score Float64, rubric String, scored_by String, scored_at DateTime64(3)",
    notes: "Human/eval-agent scoring rows.",
  },
  {
    name: "subagent_experiments",
    kind: "view",
    engine: "VIEW over subagent_runs + subagent_api_events + subagent_evals",
    schema: "task_hash, conversation_hash, agent_type, effort_level, model_name, latency_ms, input_tokens, output_tokens, total_cost_usd, result_hash, result_preview, ok, eval_score, prompt_id, ts",
    notes: "Joined experiment view for telemetry analysis.",
  },
  {
    name: "session_learnings",
    kind: "raw table",
    engine: "MergeTree ORDER BY (category, slug)",
    schema: "ts DateTime, session String, slug String, category LowCardinality(String), learning String, tags Array(String)",
    notes: "Durable session learnings table.",
  },
];

export function catalogPromptSection() {
  const lines = CATALOG.map(
    (entry) => `- \`${entry.name}\` (${entry.kind}, ${entry.engine}) — ${entry.schema}. ${entry.notes}`
  );

  return `ClickHouse catalog:

Only use these objects as written. If a requested table is not listed here, call listTables and describeTable before writing SQL.

${lines.join("\n")}`;
}
