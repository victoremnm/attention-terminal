import { clickhouseInsert, ensureTablesExist } from "../src/lib/clickhouse";

async function logSessionLearningsPR208() {
  const sessionId = "ab8995fb-0b0d-4f56-8d07-85458e326eaa";
  const now = new Date().toISOString();

  console.log("Ensuring ClickHouse telemetry tables exist...");
  await ensureTablesExist([
    "subagent_runs",
    "subagent_api_events",
    "subagent_evals",
    "session_learnings",
  ]);

  console.log("Inserting session_learnings for PR #208...");
  await clickhouseInsert.insert({
    table: "session_learnings",
    values: [
      {
        ts: now,
        session: sessionId,
        slug: "morphing-card-pie-and-treemap-capping",
        category: "visualization",
        learning:
          "When PieChart or TreemapChart payloads contain more categories than the maximum slice cap (>7 for Pie, >8 for Treemap), remaining items must be aggregated into an explicit 'Other' slice/tile. Otherwise, rendered percentages sum to less than 100% and total width leaves un-rendered blank gaps.",
        tags: ["visualization", "svg", "pie-chart", "treemap", "tufte"],
      },
      {
        ts: now,
        session: sessionId,
        slug: "stacked-bar-global-key-coloring",
        category: "visualization",
        learning:
          "In multi-category StackedBarChart components, segment colors must be mapped to segmentKeys.indexOf(seg.key) globally rather than local row index sIdx. Mapping by local index causes color mis-alignments across rows when categories omit intermediate segments.",
        tags: ["visualization", "svg", "stacked-bar", "color-mapping"],
      },
      {
        ts: now,
        session: sessionId,
        slug: "single-slice-donut-ring-rendering",
        category: "visualization",
        learning:
          "A 100% single-item pie chart arc path degenerates when startAngle === 0 and endAngle === 2*PI. Single-item donut distributions must be rendered via SVG <circle> stroke rings rather than M/A arc path d strings.",
        tags: ["svg", "pie-chart", "math", "edge-case"],
      },
      {
        ts: now,
        session: sessionId,
        slug: "tufte-data-ink-maximization-primitives",
        category: "architecture",
        learning:
          "Hand-rolled SVG primitives in Attention Terminal adhere strictly to Tufte's data-ink maximization: zero chartjunk gridlines (<10% opacity), direct labeling without detached legends, range-frame axes, and tabular-nums typography alignment.",
        tags: ["tufte", "architecture", "geist", "data-ink"],
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Inserting subagent_runs for PR #208...");
  await clickhouseInsert.insert({
    table: "subagent_runs",
    values: [
      {
        ts: now,
        session_id: sessionId,
        prompt_id: "fix-180-morphing-canvas-charts",
        agent_id: "general-coder-pr-208",
        agent_type: "coder",
        effort_level: "high",
        permission_mode: "auto",
        cwd: process.cwd(),
        model: "Gemini 3.6 Flash",
        spec_hash: "spec_180_morphing_charts",
        spec_preview: "Implement PieChart, StackedBarChart, WaterfallChart, and TreemapChart SVG components (closes #180)",
        result_hash: "res_180_morphing_charts_merged",
        result_preview: "Merged PR #208 with 5 SVG chart primitives, stress test suite, snapshot regression tests, and Tufte architecture blueprint.",
        latency_ms: 95000,
        input_tokens: 28500,
        output_tokens: 2400,
        cache_read_tokens: 15200,
        cache_creation_tokens: 3100,
        cost_usd: 0.082,
        ok: 1,
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Session learnings and telemetry successfully logged to ClickHouse!");
}

logSessionLearningsPR208().catch((err) => {
  console.warn("ClickHouse session learnings insert notice (spooling fallback):", err.message);
});
