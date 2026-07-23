import { clickhouse, missingColumns, missingTables } from "./clickhouse";

export type UsageProvenance = "measured" | "estimated";

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
  input_tokens_provenance: UsageProvenance;
  output_tokens: number;
  output_tokens_provenance: UsageProvenance;
  cost_usd: number;
  cost_provenance: UsageProvenance;
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
  input_tokens_provenance: UsageProvenance;
  output_tokens: number;
  output_tokens_provenance: UsageProvenance;
  cost_usd: number;
  cost_provenance: UsageProvenance;
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
  input_tokens_provenance: UsageProvenance;
  output_tokens: number;
  output_tokens_provenance: UsageProvenance;
  total_cost_usd: number;
  cost_provenance: UsageProvenance;
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

export interface ModelDistributionSummary {
  model: string;
  count: number;
  minLatencyMs: number;
  q1LatencyMs: number;
  medianLatencyMs: number;
  q3LatencyMs: number;
  maxLatencyMs: number;
  latencies: number[];
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
  avgCostUsd: number;
  successRate: number;
}

export interface TelemetryPayload {
  kpis: TelemetryKpiSummary;
  runs: SubagentRunRow[];
  apiEvents: SubagentApiEventRow[];
  experiments: SubagentExperimentRow[];
  learnings: SessionLearningRow[];
  modelStats: ModelDistributionSummary[];
  provenance: {
    sql: string;
    elapsedMs: number;
    tables: string[];
  };
}

function normalizeProvenance(value: unknown, fallback: UsageProvenance): UsageProvenance {
  return value === "measured" || value === "estimated" ? value : fallback;
}

export function provenanceColumn(column: string, availableColumns: ReadonlySet<string>): string {
  return availableColumns.has(column) ? column : `'estimated' AS ${column}`;
}

/**
 * Fill only values explicitly marked as estimated. A provider-reported zero is
 * meaningful and must not be replaced by a presentation-layer estimate.
 */
export function enrichTelemetryRun(run: SubagentRunRow): SubagentRunRow {
  let inTokens = Number(run.input_tokens || 0);
  let outTokens = Number(run.output_tokens || 0);
  let cost = Number(run.cost_usd || 0);
  const inputTokensProvenance = normalizeProvenance(
    run.input_tokens_provenance,
    inTokens === 0 ? "estimated" : "measured",
  );
  const outputTokensProvenance = normalizeProvenance(
    run.output_tokens_provenance,
    outTokens === 0 ? "estimated" : "measured",
  );
  const costProvenance = normalizeProvenance(run.cost_provenance, cost === 0 ? "estimated" : "measured");

  const modelLower = (run.model || "").toLowerCase();

  // If input/output tokens were unrecorded (0), estimate from prompt spec/result length & latency
  if (inputTokensProvenance === "estimated" && inTokens === 0) {
    const specLen = (run.spec_preview || "").length;
    const latency = Number(run.latency_ms || 0);
    inTokens = Math.max(1200, Math.round(specLen * 3.5 + (latency > 0 ? Math.min(latency * 0.8, 15000) : 2500)));
  }

  if (outputTokensProvenance === "estimated" && outTokens === 0) {
    const resultLen = (run.result_preview || "").length;
    outTokens = Math.max(350, Math.round(resultLen * 3.0 + 400));
  }

  if (costProvenance === "estimated" && cost === 0) {
    let rateIn = 0.002 / 1000;
    let rateOut = 0.006 / 1000;

    if (modelLower.includes("pro") || modelLower.includes("claude-3-5-sonnet") || modelLower.includes("gpt-4o")) {
      rateIn = 0.003 / 1000;
      rateOut = 0.015 / 1000;
    } else if (modelLower.includes("glm") || modelLower.includes("kimi") || modelLower.includes("haiku") || modelLower.includes("mini")) {
      rateIn = 0.001 / 1000;
      rateOut = 0.003 / 1000;
    }

    cost = Number((inTokens * rateIn + outTokens * rateOut).toFixed(4));
  }

  return {
    ...run,
    input_tokens: inTokens,
    input_tokens_provenance: inputTokensProvenance,
    output_tokens: outTokens,
    output_tokens_provenance: outputTokensProvenance,
    cost_usd: cost,
    cost_provenance: costProvenance,
  };
}

function computeModelDistributionStats(runs: SubagentRunRow[]): ModelDistributionSummary[] {
  const groups: Record<string, SubagentRunRow[]> = {};

  for (const r of runs) {
    const model = r.model || "unknown";
    if (!groups[model]) groups[model] = [];
    groups[model].push(r);
  }

  const result: ModelDistributionSummary[] = [];

  for (const [model, modelRuns] of Object.entries(groups)) {
    const count = modelRuns.length;
    const latencies = modelRuns.map((r) => Number(r.latency_ms || 0)).sort((a, b) => a - b);
    const minLatencyMs = latencies[0] || 0;
    const maxLatencyMs = latencies[latencies.length - 1] || 0;
    const q1LatencyMs = latencies[Math.floor(count * 0.25)] || minLatencyMs;
    const medianLatencyMs = latencies[Math.floor(count * 0.50)] || minLatencyMs;
    const q3LatencyMs = latencies[Math.floor(count * 0.75)] || maxLatencyMs;

    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0;
    let okCount = 0;

    for (const r of modelRuns) {
      totalIn += r.input_tokens;
      totalOut += r.output_tokens;
      totalCost += r.cost_usd;
      if (r.ok === 1) okCount++;
    }

    result.push({
      model,
      count,
      minLatencyMs,
      q1LatencyMs,
      medianLatencyMs,
      q3LatencyMs,
      maxLatencyMs,
      latencies,
      avgInputTokens: Math.round(totalIn / count),
      avgOutputTokens: Math.round(totalOut / count),
      totalCostUsd: Number(totalCost.toFixed(4)),
      avgCostUsd: Number((totalCost / count).toFixed(4)),
      successRate: Number(((okCount / count) * 100).toFixed(1)),
    });
  }

  return result.sort((a, b) => b.count - a.count);
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

  const [missingRunColumns, missingEventColumns, missingExperimentColumns] = await Promise.all([
    hasRuns
      ? missingColumns("subagent_runs", ["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"])
      : Promise.resolve([]),
    hasEvents
      ? missingColumns("subagent_api_events", ["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"])
      : Promise.resolve([]),
    hasExperiments
      ? missingColumns("subagent_experiments", ["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"])
      : Promise.resolve([]),
  ]);
  const runColumns = new Set(["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"].filter((column) => !missingRunColumns.includes(column)));
  const eventColumns = new Set(["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"].filter((column) => !missingEventColumns.includes(column)));
  const experimentColumns = new Set(["input_tokens_provenance", "output_tokens_provenance", "cost_provenance"].filter((column) => !missingExperimentColumns.includes(column)));

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
          ${provenanceColumn("input_tokens_provenance", runColumns)},
          output_tokens,
          ${provenanceColumn("output_tokens_provenance", runColumns)},
          cost_usd,
          ${provenanceColumn("cost_provenance", runColumns)},
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
          ${provenanceColumn("input_tokens_provenance", eventColumns)},
          output_tokens,
          ${provenanceColumn("output_tokens_provenance", eventColumns)},
          cost_usd,
          ${provenanceColumn("cost_provenance", eventColumns)},
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
          ${provenanceColumn("input_tokens_provenance", experimentColumns)},
          output_tokens,
          ${provenanceColumn("output_tokens_provenance", experimentColumns)},
          total_cost_usd,
          ${provenanceColumn("cost_provenance", experimentColumns)},
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

  const [rawRuns, rawApiEvents, rawExperiments, learnings] = await Promise.all([
    runsQuery,
    eventsQuery,
    experimentsQuery,
    learningsQuery,
  ]);

  // Enrich only values marked as estimated; preserve measured provider values.
  const runs: SubagentRunRow[] = rawRuns.map(enrichTelemetryRun);

  // Compute model distribution stats (min, Q1, median, Q3, max, violin contours)
  const modelStats = computeModelDistributionStats(runs);

  // Synthesize API events for runs that have no OTel trace in subagent_api_events
  const existingEventPrompts = new Set(rawApiEvents.map((e) => e.prompt_id));
  const apiEvents: SubagentApiEventRow[] = [...rawApiEvents];

  for (const r of runs) {
    if (!existingEventPrompts.has(r.prompt_id)) {
      apiEvents.push({
        ts: r.ts,
        session_id: r.session_id,
        prompt_id: r.prompt_id,
        query_source: "subagent",
        agent_name: r.agent_id || r.agent_type,
        model: r.model || "claude-3-5-sonnet",
        input_tokens: r.input_tokens,
        input_tokens_provenance: r.input_tokens_provenance,
        output_tokens: r.output_tokens,
        output_tokens_provenance: r.output_tokens_provenance,
        cost_usd: r.cost_usd,
        cost_provenance: r.cost_provenance,
        duration_ms: r.latency_ms,
      });
    }
  }

  // Enrich experiments view as well
  const experiments: SubagentExperimentRow[] = rawExperiments.map((e) => {
    const matchedRun = runs.find((r) => r.prompt_id === e.prompt_id);
    if (matchedRun) {
      return {
        ...e,
        input_tokens: matchedRun.input_tokens,
        output_tokens: matchedRun.output_tokens,
        total_cost_usd: matchedRun.cost_usd,
      };
    }
    return e;
  });

  // Calculate aggregated KPIs across enriched runs
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalLatencyMs = 0;

  for (const r of runs) {
    totalInputTokens += r.input_tokens;
    totalOutputTokens += r.output_tokens;
    totalCostUsd += r.cost_usd;
    totalLatencyMs += Number(r.latency_ms || 0);
  }

  const kpis: TelemetryKpiSummary = {
    runCount: runs.length,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    avgLatencyMs: runs.length > 0 ? Math.round(totalLatencyMs / runs.length) : 0,
  };

  const elapsedMs = Math.round(performance.now() - start);

  return {
    kpis,
    runs,
    apiEvents,
    experiments,
    learnings,
    modelStats,
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
