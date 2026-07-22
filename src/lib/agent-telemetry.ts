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
import { drilldownSpecHash } from "./agent-model";

interface AgentRunRecord {
  agentType: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // The user's question + repo context, so runs against the same question
  // across different models share a spec_hash for comparison.
  repoName?: string;
  question?: string;
}

export async function logAgentRun(record: AgentRunRecord): Promise<void> {
  const now = new Date();
  const ts = now.toISOString().slice(0, 19).replace("T", " ");
  // Populate spec_hash so the subagent_experiments view can GROUP BY
  // task_hash to compare models on the same question. Falls back to a
  // timestamp-based hash if repoName/question are absent (backward compat).
  const spec_hash = record.repoName && record.question
    ? drilldownSpecHash(record.repoName, record.question)
    : `run_${now.getTime()}`;
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
      input_tokens_provenance: record.inputTokens > 0 ? "measured" : "estimated",
      output_tokens: record.outputTokens,
      output_tokens_provenance: record.outputTokens > 0 ? "measured" : "estimated",
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: record.costUsd,
      // The AI SDK record does not include pricing, so a zero cost is not a
      // provider-reported measurement and remains eligible for estimation.
      cost_provenance: "estimated",
      spec_hash,
      result_hash: "",
      result_preview: "",
      ok: 1,
    }],
    format: "JSONEachRow",
  });
}
