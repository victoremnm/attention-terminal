-- +goose Up
-- Capture tokens/cost/model directly on subagent_runs (parsed from the sub-agent
-- transcript by the subagent-telemetry hook), so the experiment bank has real
-- quality-vs-cost-vs-speed data without needing the OpenTelemetry bridge. The
-- subagent_api_events table stays for optional OTel cross-check.
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS model LowCardinality(String) AFTER cwd;
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS input_tokens UInt64 AFTER latency_ms;
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS output_tokens UInt64 AFTER input_tokens;
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS cache_read_tokens UInt64 AFTER output_tokens;
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS cache_creation_tokens UInt64 AFTER cache_read_tokens;
ALTER TABLE subagent_runs ADD COLUMN IF NOT EXISTS cost_usd Float64 AFTER cache_creation_tokens;

DROP VIEW IF EXISTS subagent_experiments;
CREATE VIEW IF NOT EXISTS subagent_experiments AS
SELECT
    r.spec_hash              AS task_hash,
    r.session_id             AS conversation_hash,
    r.agent_type             AS agent_type,
    r.effort_level           AS effort_level,
    r.model                  AS model_name,
    r.latency_ms             AS latency_ms,
    r.input_tokens           AS input_tokens,
    r.output_tokens          AS output_tokens,
    r.cache_read_tokens      AS cache_read_tokens,
    r.cache_creation_tokens  AS cache_creation_tokens,
    r.cost_usd               AS total_cost_usd,
    r.result_hash            AS result_hash,
    r.result_preview         AS result_preview,
    r.ok                     AS ok,
    if(
        countIf(v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)) > 0,
        anyIf(v.score, v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)),
        NULL
    )                        AS eval_score,
    r.prompt_id              AS prompt_id,
    r.ts                     AS ts
FROM subagent_runs AS r FINAL
LEFT JOIN subagent_evals AS v
    ON v.spec_hash = r.spec_hash AND v.result_hash = r.result_hash
GROUP BY
    r.spec_hash, r.session_id, r.agent_type, r.effort_level, r.model, r.latency_ms,
    r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens,
    r.cost_usd, r.result_hash, r.result_preview, r.ok, r.prompt_id, r.ts;

-- +goose Down
DROP VIEW IF EXISTS subagent_experiments;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS cost_usd;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS cache_creation_tokens;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS cache_read_tokens;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS output_tokens;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS input_tokens;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS model;
CREATE VIEW IF NOT EXISTS subagent_experiments AS
SELECT
    r.spec_hash AS task_hash, r.session_id AS conversation_hash, r.agent_type AS agent_type,
    r.effort_level AS effort_level, any(e.model) AS model_name, r.latency_ms AS latency_ms,
    sum(e.input_tokens) AS input_tokens, sum(e.output_tokens) AS output_tokens,
    sum(e.cost_usd) AS total_cost_usd, r.result_hash AS result_hash,
    r.result_preview AS result_preview, r.ok AS ok, any(v.score) AS eval_score,
    r.prompt_id AS prompt_id, r.ts AS ts
FROM subagent_runs AS r
LEFT JOIN (SELECT * FROM subagent_api_events WHERE query_source = 'subagent') AS e USING (prompt_id)
LEFT JOIN subagent_evals AS v ON v.spec_hash = r.spec_hash AND v.result_hash = r.result_hash
GROUP BY r.spec_hash, r.session_id, r.agent_type, r.effort_level, r.latency_ms,
    r.result_hash, r.result_preview, r.ok, r.prompt_id, r.ts;
