import { clickhouse, missingTables } from "./clickhouse";

export interface TelemetryKpiSummary {
  runCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export interface SubagentRunRow {
  ts: string;
  session_id: string;
  prompt_id: string;
  agent_id: string;
  agent_type: string;
  effort_level: string;
  model: string;
  spec_preview: string;
  result_preview: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ok: number;
}

export interface SubagentApiEventRow {
  ts: string;
  session_id: string;
  prompt_id: string;
  query_source: string;
  agent_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

export interface SubagentExperimentRow {
  task_hash: string;
  conversation_hash: string;
  agent_type: string;
  effort_level: string;
  model_name: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  result_preview: string;
  ok: number;
  eval_score?: number | null;
  prompt_id: string;
  ts: string;
}

export interface SessionLearningRow {
  ts: string;
  session: string;
  slug: string;
  category: string;
  learning: string;
  tags: string[];
}

export interface TelemetryPayload {
  kpis: TelemetryKpiSummary;
  runs: SubagentRunRow[];
  apiEvents: SubagentApiEventRow[];
  experiments: SubagentExperimentRow[];
  learnings: SessionLearningRow[];
  provenance: {
    sql: string;
    elapsedMs: number;
    tables: string[];
  };
}

export async function fetchTelemetryData(): Promise<TelemetryPayload> {
  const start = performance.now();

  const [missingRuns, missingEvents, missingLearnings, missingExperiments] =
    await Promise.all([
      missingTables(["subagent_runs"]),
      missingTables(["subagent_api_events"]),
      missingTables(["session_learnings"]),
      missingTables(["subagent_experiments"]),
    ]);

  const hasRuns = missingRuns.length === 0;
  const hasEvents = missingEvents.length === 0;
  const hasLearnings = missingLearnings.length === 0;
  const hasExperiments = missingExperiments.length === 0;

  const kpisQuery = hasRuns
    ? clickhouse
        .query({
          query: `
        SELECT
          count() AS run_count,
          sum(input_tokens) AS total_input,
          sum(output_tokens) AS total_output,
          sum(cost_usd) AS total_cost,
          avg(latency_ms) AS avg_latency
        FROM subagent_runs FINAL
      `,
          format: "JSONEachRow",
        })
        .then((res) =>
          res.json<{
            run_count: string | number;
            total_input: string | number;
            total_output: string | number;
            total_cost: string | number;
            avg_latency: string | number;
          }>()
        )
    : Promise.resolve([]);

  const runsQuery = hasRuns
    ? clickhouse
        .query({
          query: `
        SELECT
          toString(ts) AS ts,
          session_id,
          prompt_id,
          agent_id,
          agent_type,
          effort_level,
          model,
          spec_preview,
          result_preview,
          latency_ms,
          input_tokens,
          output_tokens,
          cost_usd,
          ok
        FROM subagent_runs FINAL
        ORDER BY ts DESC
        LIMIT 50
      `,
          format: "JSONEachRow",
        })
        .then((res) => res.json<SubagentRunRow>())
    : Promise.resolve([]);

  const eventsQuery = hasEvents
    ? clickhouse
        .query({
          query: `
        SELECT
          toString(ts) AS ts,
          session_id,
          prompt_id,
          query_source,
          agent_name,
          model,
          input_tokens,
          output_tokens,
          cost_usd,
          duration_ms
        FROM subagent_api_events
        ORDER BY ts DESC
        LIMIT 50
      `,
          format: "JSONEachRow",
        })
        .then((res) => res.json<SubagentApiEventRow>())
    : Promise.resolve([]);

  const experimentsQuery = hasExperiments
    ? clickhouse
        .query({
          query: `
        SELECT
          task_hash,
          conversation_hash,
          agent_type,
          effort_level,
          model_name,
          latency_ms,
          input_tokens,
          output_tokens,
          total_cost_usd,
          result_preview,
          ok,
          eval_score,
          prompt_id,
          toString(ts) AS ts
        FROM subagent_experiments
        ORDER BY ts DESC
        LIMIT 50
      `,
          format: "JSONEachRow",
        })
        .then((res) => res.json<SubagentExperimentRow>())
    : Promise.resolve([]);

  const learningsQuery = hasLearnings
    ? clickhouse
        .query({
          query: `
        SELECT
          toString(ts) AS ts,
          session,
          slug,
          category,
          learning,
          tags
        FROM session_learnings
        ORDER BY ts DESC
        LIMIT 50
      `,
          format: "JSONEachRow",
        })
        .then((res) => res.json<SessionLearningRow>())
    : Promise.resolve([]);

  const [kpiRows, runs, apiEvents, experiments, learnings] = await Promise.all([
    kpisQuery,
    runsQuery,
    eventsQuery,
    experimentsQuery,
    learningsQuery,
  ]);

  const kpiRow = kpiRows[0];
  const kpis: TelemetryKpiSummary = {
    runCount: Number(kpiRow?.run_count ?? 0),
    totalInputTokens: Number(kpiRow?.total_input ?? 0),
    totalOutputTokens: Number(kpiRow?.total_output ?? 0),
    totalCostUsd: Number(kpiRow?.total_cost ?? 0),
    avgLatencyMs: Math.round(Number(kpiRow?.avg_latency ?? 0)),
  };

  const elapsedMs = Math.round(performance.now() - start);

  return {
    kpis,
    runs,
    apiEvents,
    experiments,
    learnings,
    provenance: {
      sql: `SELECT * FROM subagent_runs FINAL; SELECT * FROM subagent_api_events; SELECT * FROM session_learnings;`,
      elapsedMs,
      tables: [
        ...(hasRuns ? ["subagent_runs"] : []),
        ...(hasEvents ? ["subagent_api_events"] : []),
        ...(hasLearnings ? ["session_learnings"] : []),
        ...(hasExperiments ? ["subagent_experiments"] : []),
      ],
    },
  };
}
