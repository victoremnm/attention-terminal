-- +goose Up
-- Fix: subagent_experiments reported eval_score = 0 for not-yet-evaluated runs.
-- The LEFT JOIN to subagent_evals fills the non-nullable Float64 `score` with 0 for
-- unmatched rows, so `any(v.score)` couldn't tell "scored 0" from "unscored" — every
-- pending run looked like a failed eval. Now eval_score is NULL until a real eval row
-- (scored_at set) matches. Recreates the view from migration 000010 with that change.
DROP VIEW IF EXISTS subagent_experiments;

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
    -- NULL when no eval matched; the real score otherwise. Unmatched LEFT JOIN rows
    -- default scored_at to the epoch, so a real-timestamp guard separates them.
    if(
        countIf(v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)) > 0,
        anyIf(v.score, v.scored_at > toDateTime64('2000-01-01 00:00:00', 3)),
        NULL
    )                               AS eval_score,
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
