import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { tool } from "ai";
import { z } from "zod";
import { dailyDigest } from "./digest";
import { RenderPayloadSchema } from "./render-payload";

let clickhouse: ClickHouseClient | undefined;

function getClickHouse(): ClickHouseClient {
  if (clickhouse) return clickhouse;

  if (process.env.CLICKHOUSE_URL) {
    clickhouse = createClient({
      url: process.env.CLICKHOUSE_URL,
      username: process.env.CLICKHOUSE_USER ?? process.env.DB_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? process.env.DB_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
      request_timeout: 30_000,
    });
    return clickhouse;
  }

  clickhouse = createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER ?? process.env.DB_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
    request_timeout: 30_000,
  });
  return clickhouse;
}

const READ_ONLY_STATEMENTS = /^\s*(select|with|show|describe|desc|explain|exists)\b/i;
const MAX_OUTPUT_CHARS = 50_000;

function hasMultipleStatements(query: string) {
  return query.replace(/;+\s*$/, "").includes(";");
}

function capOutput(rows: unknown[]) {
  let out = rows;
  while (out.length > 1 && JSON.stringify(out).length > MAX_OUTPUT_CHARS) {
    out = out.slice(0, Math.ceil(out.length / 2));
  }
  return { rows: out, truncated: out.length < rows.length };
}

export const listTables = tool({
  description: "List Attention Terminal ClickHouse tables with engine, rows, and size. Use before querying unknown data.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await getClickHouse().query({
      query: `
        SELECT database, name, engine, total_rows, formatReadableSize(total_bytes) AS size
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, name
      `,
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    return { tables: await result.json() };
  },
});

export const describeTable = tool({
  description: "Describe one ClickHouse table. The table can be unqualified or database-qualified.",
  inputSchema: z.object({
    table: z.string().min(1).max(160),
  }),
  execute: async ({ table }) => {
    const [database, name] = table.includes(".") ? table.split(".", 2) : [undefined, table];
    const result = await getClickHouse().query({
      query: database
        ? "DESCRIBE TABLE {database: Identifier}.{name: Identifier}"
        : "DESCRIBE TABLE {name: Identifier}",
      query_params: { database, name },
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    return { columns: await result.json() };
  },
});

export const runReadOnlyQuery = tool({
  description:
    "Run a bounded read-only ClickHouse SQL query. Only SELECT-style statements are allowed. Prefer aggregations and include LIMIT on raw row queries.",
  inputSchema: z.object({
    query: z.string().min(1).max(12_000),
  }),
  execute: async ({ query }) => {
    if (!READ_ONLY_STATEMENTS.test(query) || hasMultipleStatements(query)) {
      return {
        error: "Only one read-only SELECT-style statement is allowed.",
      };
    }

    try {
      const result = await getClickHouse().query({
        query,
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "2",
          max_result_rows: "1000",
          result_overflow_mode: "break",
          max_execution_time: 30,
        },
      });
      const rows = await result.json();
      const capped = capOutput(rows);
      return {
        rowCount: rows.length,
        rows: capped.rows,
        ...(capped.truncated ? { note: "Result truncated. Refine the query or aggregate." } : {}),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const getDailyDigest = tool({
  description:
    "Compute the Daily Skinny digest payload from the existing HN and GitHub feeds. Use for empty prompt, daily-open, 'what's new', and broad daily triage.",
  inputSchema: z.object({
    noiseFloor: z.number().min(0).max(1).default(0.2),
  }),
  execute: async ({ noiseFloor }) => dailyDigest(noiseFloor),
});

export const renderAnswer = tool({
  description:
    "Validate and render an Attention Terminal answer payload. Use this instead of markdown tables or long prose. Payloads must match the answer grammar.",
  inputSchema: z.object({
    payload: RenderPayloadSchema,
  }),
  execute: async ({ payload }) => {
    const parsed = RenderPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    return {
      ok: true,
      type: parsed.data.type,
      note: "Rendered to the user. Do not repeat the payload as prose.",
    };
  },
});

export const attentionTools = {
  listTables,
  describeTable,
  runReadOnlyQuery,
  getDailyDigest,
  renderAnswer,
};
