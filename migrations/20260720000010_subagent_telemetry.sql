-- +goose Up
-- Sub-agent telemetry: "every sub-agent run is an experiment row" (quality vs cost vs speed).
-- Two ingest sources joined on prompt_id:
--   subagent_runs        <- Claude Code SubagentStop hook (identity, spec/result hashes, effort, latency)
--   subagent_api_events  <- Claude Code OpenTelemetry claude_code.api_request (model, tokens, cost)
-- subagent_evals is filled later (manual score or an eval agent). The subagent_experiments view
-- joins all three. Hook + schema shipped by the subagent-telemetry skill.
CREATE TABLE IF NOT EXISTS subagent_runs
(
    ts               DateTime64(3),
    session_id       String,
    prompt_id        String,
    agent_id         String,
    agent_type       LowCardinality(String),
    effort_level     LowCardinality(String),
    permission_mode  LowCardinality(String),
    cwd              String,
    spec_hash        String,
    spec_preview     String,
    result_hash      String,
    result_preview   String,
    latency_ms       UInt64,
    ok               UInt8
)
ENGINE = ReplacingMergeTree(ts)
ORDER BY (session_id, agent_id, prompt_id);

CREATE TABLE IF NOT EXISTS subagent_api_events
(
    ts                     DateTime64(3),
    session_id             String,
    prompt_id              String,
    query_source           LowCardinality(String),   -- 'main' | 'subagent'
    agent_name             LowCardinality(String),
    model                  LowCardinality(String),
    input_tokens           UInt64,
    output_tokens          UInt64,
    cache_read_tokens      UInt64,
    cache_creation_tokens  UInt64,
    cost_usd               Float64,
    duration_ms            UInt64
)
ENGINE = MergeTree
ORDER BY (prompt_id, ts);

CREATE TABLE IF NOT EXISTS subagent_evals
(
    spec_hash    String,
    result_hash  String,
    score        Float64,
    rubric       String,
    scored_by    String,
    scored_at    DateTime64(3)
)
ENGINE = ReplacingMergeTree(scored_at)
ORDER BY (spec_hash, result_hash);

-- One row per sub-agent run with quality-vs-cost-vs-speed columns. Cost/token columns are
-- empty until the OpenTelemetry bridge is wired (LEFT JOIN) — expected.
CREATE VIEW IF NOT EXISTS subagent_experiments AS
SELECT
    r.spec_hash                     AS task_hash,
    r.session_id                    AS conversation_hash,
    r.agent_type                    AS agent_type,
    r.effort_level                  AS effort_level,
    any(e.model)                    AS model_name,
    r.latency_ms                    AS latency_ms,
    sum(e.input_tokens)             AS input_tokens,
    sum(e.output_tokens)            AS output_tokens,
    sum(e.cost_usd)                 AS total_cost_usd,
    r.result_hash                   AS result_hash,
    r.result_preview                AS result_preview,
    r.ok                            AS ok,
    any(v.score)                    AS eval_score,
    r.prompt_id                     AS prompt_id,
    r.ts                            AS ts
FROM subagent_runs AS r
LEFT JOIN (SELECT * FROM subagent_api_events WHERE query_source = 'subagent') AS e
    USING (prompt_id)
LEFT JOIN subagent_evals AS v
    ON v.spec_hash = r.spec_hash AND v.result_hash = r.result_hash
GROUP BY
    r.spec_hash, r.session_id, r.agent_type, r.effort_level, r.latency_ms,
    r.result_hash, r.result_preview, r.ok, r.prompt_id, r.ts;

-- +goose Down
DROP VIEW IF EXISTS subagent_experiments;
DROP TABLE IF EXISTS subagent_evals;
DROP TABLE IF EXISTS subagent_api_events;
DROP TABLE IF EXISTS subagent_runs;
