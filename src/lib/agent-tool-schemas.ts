import { tool } from "ai";
import { z } from "zod";
import { RenderPayloadSchema, VisualizationTypeSchema, CardQuerySchema, TableColumnSchema } from "./render-payload";

// Schema-only tool definitions, shared between the agent task (which attaches
// execute functions in agent-tools.ts) and the /api/chat head-start route.
//
// HARD CONSTRAINT: this module may import only `ai`, `zod`, and other
// zod-only modules. The head-start route bundle must stay lightweight —
// pulling in @clickhouse/client or the trigger runtime here would drag them
// into the route at build time (see @trigger.dev/sdk chat-server docs).

export const listTablesDef = {
  description:
    "List up to 50 Attention Terminal ClickHouse tables with engine, rows, and size. Use this first before custom SQL, then inspect specific tables with describeTable.",
  inputSchema: z.object({}),
} as const;

export const describeTableDef = {
  description:
    "Describe one ClickHouse table after listTables. The table can be unqualified or database-qualified.",
  inputSchema: z.object({
    table: z.string().min(1).max(160),
  }),
} as const;

export const runReadOnlyQueryDef = {
  description:
    "Run a bounded read-only ClickHouse SQL query. Only SELECT-style statements are allowed. Call listTables first, then describeTable on every referenced table, before using this tool. The result includes real query analytics `{ sql, rowsRead, elapsedMs }`; pass that object unchanged into buildMorphingCard/buildTablePayload.",
  inputSchema: z.object({
    query: z.string().min(1).max(12_000),
  }),
} as const;

export const getDailyDigestDef = {
  description:
    "Compute the Daily Skinny digest payload from the existing HN and GitHub feeds. Use for empty prompt, daily-open, 'what's new', and broad daily triage.",
  inputSchema: z.object({
    noiseFloor: z.number().min(0).max(1).default(0),
  }),
} as const;

export const getRealBuildersDef = {
  description:
    "Compute the 'real builders' DevScatter answer: per-actor push/PR activity over a 7d or 30d window from github_events, with bot and single-repo script-spam accounts filtered out and disclosed. Use for 'who are the real builders (this week)?' and similar builder-attribution prompts.",
  inputSchema: z.object({
    window: z.enum(["7d", "30d"]).default("7d"),
  }),
} as const;

export const getRepoDrilldownDef = {
  description:
    "Compute a repo drill-down answer for a GitHub owner/repo name: metadata, 24h KPIs, hourly velocity, latest push/PR feed, and ClickHouse query provenance. Use when the user asks why a specific repo is moving, asks to double-click a repo, or names a GitHub repo directly.",
  inputSchema: z.object({
    repoName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(160),
  }),
} as const;

export const renderAnswerDef = {
  description:
    "Validate and render an Attention Terminal answer payload. Use this instead of markdown tables or long prose. Payloads must match the answer grammar.",
  inputSchema: z.object({
    payload: RenderPayloadSchema,
  }),
} as const;

// Execute-less tool set for the head-start route. Step 1 runs in the Next.js
// process and stops at the first tool call; the agent run executes the tools
// after handover, so no execute functions are needed (or wanted) here.

export const runDataRetrievalDef = {
  description:
    "Data Retrieval Agent: Translates semantic intent into ClickHouse SQL, executes the query, persists the full raw result set to temporary storage, and returns schema metadata, summary statistics (variance, cardinality, data types), a retrieval key, a bounded `sampleRows` array (<=50 rows), and real query analytics `{ sql, rowsRead, elapsedMs }`. Pass sampleRows straight into buildMorphingCard's `rows` argument and pass the returned query analytics object through unchanged — never invent zero-valued query stats — so the answer renders both its data and its view-SQL analytics.",
  inputSchema: z.object({
    intent: z.string().min(1).max(12_000),
  }),
} as const;

export const runVisualizationMappingDef = {
  description:
    "Visualization Mapping Agent: Maps data metadata and semantic intent against the data storytelling taxonomy to return a UI configuration payload (chart type, axes mapping, stylistic overrides). The client now renders the supported chart primitives for the fixed taxonomy, including Line Graph, Area Chart, Bar Chart, Pie Chart, Stacked Bar Chart, Waterfall Chart, Treemap, Spider Chart, Slopegraph, Gantt Chart, Dot Plot, Bullet Graph, Square Area Chart, Unit Chart, Boxplot, Scatterplot, Bubble Chart, Sankey Diagram, Flow Chart, Choropleth Map, and Data Table.",
  inputSchema: z.object({
    intent: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  }),
} as const;

export const buildMorphingCardDef = {
  description:
    "Deterministically builds a valid morphing-card renderAnswer payload from row objects you already have (from runReadOnlyQuery's `rows` or runDataRetrieval's `sampleRows`). Always prefer this over hand-constructing chartConfig yourself -- it guarantees the exact shape the client needs, so the table (and chart, for supported visualizationTypes) always renders. Pass the returned object straight into renderAnswer's `payload` argument, unmodified.",
  inputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(50).describe("Row objects exactly as returned by runReadOnlyQuery/runDataRetrieval -- do not rename, restructure, or drop keys."),
    columns: z
      .array(z.object({ field: z.string(), title: z.string() }))
      .max(12)
      .optional()
      .describe("Optional column display order/labels. Defaults to every key in the first row, in that row's own key order, humanized (snake_case -> Title Case)."),
    visualizationType: VisualizationTypeSchema.default("Data Table"),
    summary: z.string().max(500).optional(),
    query: CardQuerySchema.optional(),
  }),
} as const;

export const buildTablePayloadDef = {
  description:
    "Deterministically builds a typed table renderAnswer payload from columns and rows you already have. Use this when you want to display tabular data with explicit column types, alignment, and optional totals. Pass the returned object straight into renderAnswer's `payload` argument, unmodified.",
  inputSchema: z.object({
    columns: z.array(TableColumnSchema).min(1).max(20).describe("Column definitions with key, label, type (number/string/date/link)."),
    rows: z.array(z.record(z.string(), z.unknown())).min(0).max(200).describe("Row objects — values keyed by the column keys defined above."),
    totals: z.record(z.string(), z.number()).optional().describe("Optional totals row for numeric columns. Keys match column keys."),
    summary: z.string().max(500).optional(),
    query: CardQuerySchema.optional(),
  }),
} as const;

export const attentionToolSchemas = {
  listTables: tool(listTablesDef),
  describeTable: tool(describeTableDef),
  runReadOnlyQuery: tool(runReadOnlyQueryDef),
  getDailyDigest: tool(getDailyDigestDef),
  getRealBuilders: tool(getRealBuildersDef),
  getRepoDrilldown: tool(getRepoDrilldownDef),
  renderAnswer: tool(renderAnswerDef),
  runDataRetrieval: tool(runDataRetrievalDef),
  runVisualizationMapping: tool(runVisualizationMappingDef),
  buildMorphingCard: tool(buildMorphingCardDef),
  buildTablePayload: tool(buildTablePayloadDef),
};
