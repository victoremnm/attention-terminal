// Agent run telemetry: logs each attention-agent run to `subagent_runs` so
// the `subagent_experiments` view picks it up for cross-model comparison
// (issue #79 track #85). The view (migrations/20260720000010 +
// 20260720000013) already joins subagent_runs with subagent_evals; we just
// need to insert the run row with model + tokens + latency.
//
// Comparison query (docs/model-comparison.md):
//   SELECT model_name, count() AS runs, avg(latency_ms) AS avg_latency,
//          avg(total_cost_usd) AS avg_cost, avg(eval_score) AS avg_score
//   FROM subagent_experiments
//   WHERE agent_type='attention-agent'
//   GROUP BY model_name

import { clickhouseInsert } from "./clickhouse";

interface AgentRunRecord {
  agentType: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function logAgentRun(record: AgentRunRecord): Promise<void> {
  const now = new Date();
  const ts = now.toISOString().slice(0, 19).replace("T", " ");
  // subagent_runs schema (migrations/20260720000010 + 20260720000013):
  // ts, session_id, prompt_id, agent_id, agent_type, effort_level,
  // permission_mode, cwd, model, latency_ms, input_tokens, output_tokens,
  // cache_read_tokens, cache_creation_tokens, cost_usd, spec_hash,
  // result_hash, result_preview, ok
  await clickhouseInsert.insert({
    table: "subagent_runs",
    values: [{
      ts,
      session_id: `attention-agent-${ts}`,
      prompt_id: `run-${now.getTime()}`,
      agent_id: "attention-agent",
      agent_type: record.agentType,
      effort_level: "default",
      permission_mode: "auto",
      cwd: "",
      model: record.model,
      latency_ms: record.latencyMs,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: record.costUsd,
      spec_hash: "",
      result_hash: "",
      result_preview: "",
      ok: 1,
    }],
    format: "JSONEachRow",
  });
}