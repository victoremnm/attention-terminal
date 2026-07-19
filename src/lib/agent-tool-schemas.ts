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
    noiseFloor: z.number().min(0).max(1).default(0.2),
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
export const attentionToolSchemas = {
  listTables: tool(listTablesDef),
  describeTable: tool(describeTableDef),
  runReadOnlyQuery: tool(runReadOnlyQueryDef),
  getDailyDigest: tool(getDailyDigestDef),
  renderAnswer: tool(renderAnswerDef),
};
