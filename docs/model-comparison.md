# Model comparison: glm-5.2 vs gpt-5.1

Cross-model comparison harness for the attention-agent (issue #79 track #85).

## How it works

Each attention-agent run logs to `subagent_runs` (model, tokens, latency, cost). The `subagent_experiments` view picks it up automatically. Token and cost values include provenance: `measured` means the provider reported the value, while `estimated` means the logger or query layer filled a missing value. Run the same drilldown question against both models by switching `ATTENTION_AGENT_MODEL` between runs.

## Switching models

```bash
# Default (gpt-5.1)
export ATTENTION_AGENT_MODEL=openai:gpt-5.1

# glm-5.2 via local Ollama
export ATTENTION_AGENT_MODEL=glm:glm-5.2
# Ensure Ollama is running: ollama serve
# And the model is pulled: ollama pull glm-5.2
```

Both the head-start route (`app/api/chat/route.ts`) and the agent worker (`src/trigger/attention-agent.ts`) read the same env var via `resolveAgentModel()` in `src/lib/agent-model.ts`, so they stay in sync.

## Comparison query

```sql
SELECT
    model_name,
    count() AS runs,
    avg(latency_ms) AS avg_latency_ms,
    avg(input_tokens) AS avg_input_tokens,
    avg(output_tokens) AS avg_output_tokens,
    avg(total_cost_usd) AS avg_cost_usd,
    groupUniqArray(input_tokens_provenance) AS input_token_provenance,
    groupUniqArray(output_tokens_provenance) AS output_token_provenance,
    groupUniqArray(cost_provenance) AS cost_provenance,
    avg(eval_score) AS avg_eval_score
FROM subagent_experiments
WHERE agent_type = 'attention-agent'
GROUP BY model_name
ORDER BY runs DESC
```

## Spec hash

`drilldownSpecHash(repoName, question)` in `src/lib/agent-model.ts` produces a stable hash for the same repo + question pair, so you can GROUP BY spec_hash to compare the same question across models:

```sql
SELECT
    spec_hash,
    model_name,
    latency_ms,
    input_tokens,
    output_tokens
FROM subagent_experiments
WHERE agent_type = 'attention-agent'
ORDER BY spec_hash, model_name
```
