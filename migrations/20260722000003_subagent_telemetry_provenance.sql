-- +goose Up
-- Distinguish provider-reported usage from values estimated by the ingestion
-- or presentation layer. Keep the fields non-null so old rows and writers can
-- continue to use ClickHouse defaults while new writers record provenance.
ALTER TABLE subagent_runs
    ADD COLUMN IF NOT EXISTS input_tokens_provenance LowCardinality(String) DEFAULT 'estimated' AFTER input_tokens;
ALTER TABLE subagent_runs
    ADD COLUMN IF NOT EXISTS output_tokens_provenance LowCardinality(String) DEFAULT 'estimated' AFTER output_tokens;
ALTER TABLE subagent_runs
    ADD COLUMN IF NOT EXISTS cost_provenance LowCardinality(String) DEFAULT 'estimated' AFTER cost_usd;

ALTER TABLE subagent_api_events
    ADD COLUMN IF NOT EXISTS input_tokens_provenance LowCardinality(String) DEFAULT 'estimated' AFTER input_tokens;
ALTER TABLE subagent_api_events
    ADD COLUMN IF NOT EXISTS output_tokens_provenance LowCardinality(String) DEFAULT 'estimated' AFTER output_tokens;
ALTER TABLE subagent_api_events
    ADD COLUMN IF NOT EXISTS cost_provenance LowCardinality(String) DEFAULT 'estimated' AFTER cost_usd;

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
    r.input_tokens_provenance  AS input_tokens_provenance,
    r.output_tokens_provenance AS output_tokens_provenance,
    r.cost_provenance          AS cost_provenance,
    r.result_hash             AS result_hash,
    r.result_preview          AS result_preview,
    r.ok                      AS ok,
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
    r.cost_usd, r.input_tokens_provenance, r.output_tokens_provenance, r.cost_provenance,
    r.result_hash, r.result_preview, r.ok, r.prompt_id, r.ts;

-- +goose Down
DROP VIEW IF EXISTS subagent_experiments;
ALTER TABLE subagent_api_events DROP COLUMN IF EXISTS cost_provenance;
ALTER TABLE subagent_api_events DROP COLUMN IF EXISTS output_tokens_provenance;
ALTER TABLE subagent_api_events DROP COLUMN IF EXISTS input_tokens_provenance;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS cost_provenance;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS output_tokens_provenance;
ALTER TABLE subagent_runs DROP COLUMN IF EXISTS input_tokens_provenance;

CREATE VIEW IF NOT EXISTS subagent_experiments AS
SELECT
    r.spec_hash AS task_hash, r.session_id AS conversation_hash, r.agent_type AS agent_type,
    r.effort_level AS effort_level, r.model AS model_name, r.latency_ms AS latency_ms,
    r.input_tokens AS input_tokens, r.output_tokens AS output_tokens,
    r.cache_read_tokens AS cache_read_tokens, r.cache_creation_tokens AS cache_creation_tokens,
    r.cost_usd AS total_cost_usd, r.result_hash AS result_hash,
    r.result_preview AS result_preview, r.ok AS ok,
    if(
        countIf(v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)) > 0,
        anyIf(v.score, v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)),
        NULL
    ) AS eval_score,
    r.prompt_id AS prompt_id, r.ts AS ts
FROM subagent_runs AS r FINAL
LEFT JOIN subagent_evals AS v
    ON v.spec_hash = r.spec_hash AND v.result_hash = r.result_hash
GROUP BY
    r.spec_hash, r.session_id, r.agent_type, r.effort_level, r.model, r.latency_ms,
    r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens,
    r.cost_usd, r.result_hash, r.result_preview, r.ok, r.prompt_id, r.ts;
