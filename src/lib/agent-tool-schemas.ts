import { tool } from "ai";
import { z } from "zod";
import { RenderPayloadSchema } from "./render-payload";

// Schema-only tool definitions, shared between the agent task (which attaches
// execute functions in agent-tools.ts) and the /api/chat head-start route.
//
// HARD CONSTRAINT: this module may import only `ai`, `zod`, and other
// zod-only modules. The head-start route bundle must stay lightweight —
// pulling in @clickhouse/client or the trigger runtime here would drag them
// into the route at build time (see @trigger.dev/sdk chat-server docs).

export const listTablesDef = {
  description:
    "List Attention Terminal ClickHouse tables with engine, rows, and size. Use before querying unknown data.",
  inputSchema: z.object({}),
} as const;

export const describeTableDef = {
  description: "Describe one ClickHouse table. The table can be unqualified or database-qualified.",
  inputSchema: z.object({
    table: z.string().min(1).max(160),
  }),
} as const;

export const runReadOnlyQueryDef = {
  description:
    "Run a bounded read-only ClickHouse SQL query. Only SELECT-style statements are allowed. Prefer aggregations and include LIMIT on raw row queries.",
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
    "Data Retrieval Agent: Translates semantic intent into ClickHouse SQL, executes the query, persists the raw result set to temporary storage, and returns schema metadata, summary statistics (variance, cardinality, data types), and a retrieval key.",
  inputSchema: z.object({
    intent: z.string().min(1).max(12_000),
  }),
} as const;

export const runVisualizationMappingDef = {
  description:
    "Visualization Mapping Agent: Maps data metadata and semantic intent against the data storytelling taxonomy to return a UI configuration payload (chart type, axes mapping, stylistic overrides).",
  inputSchema: z.object({
    intent: z.string(),
    metadata: z.record(z.string(), z.unknown()),
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
};
