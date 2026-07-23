import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { tool } from "ai";
import {
  describeTableDef,
  getDailyDigestDef,
  getRealBuildersDef,
  getRepoDrilldownDef,
  listTablesDef,
  renderAnswerDef,
  runReadOnlyQueryDef,
  runDataRetrievalDef,
  runVisualizationMappingDef,
} from "./agent-tool-schemas";
import { ensureTablesExist } from "./clickhouse";
import { dailyDigest } from "./digest";
import { realBuildersDeck } from "./real-builders";
import { RenderPayloadSchema } from "./render-payload";
import { repoDrilldown } from "./queries";
import { normalizeUnionQuery, runDataRetrievalAgent } from "./agents/data-retrieval-agent";
import { runVisualizationMappingAgent } from "./agents/visualization-mapping-agent";

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
const knownTables = new Set<string>();
const knownSchemas = new Map<string, string[]>();

export function resetCatalogState() {
  knownTables.clear();
  knownSchemas.clear();
}

function hasMultipleStatements(query: string) {
  return query.replace(/;+\s*$/, "").includes(";");
}

function normalizeTableName(table: string) {
  return table.trim().replace(/`/g, "").replace(/"/g, "");
}

function registerCatalogTables(tables: Array<{ database: string; name: string }>) {
  for (const table of tables) {
    knownTables.add(`${table.database}.${table.name}`);
    knownTables.add(table.name);
  }
}

function capOutput(rows: unknown[]) {
  let out = rows;
  while (out.length > 1 && JSON.stringify(out).length > MAX_OUTPUT_CHARS) {
    out = out.slice(0, Math.ceil(out.length / 2));
  }
  return { rows: out, truncated: out.length < rows.length };
}

function extractTableCandidates(query: string) {
  const cteNames = new Set<string>();
  for (const match of query.matchAll(/\b([A-Za-z_][\w$]*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1]);
  }

  const refs = new Set<string>();
  for (const match of query.matchAll(/\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?/gi)) {
    const table = match[4] ? `${match[2]}.${match[4]}` : match[2];
    if (!cteNames.has(match[2])) refs.add(normalizeTableName(table));
  }

  return [...refs];
}

function requireCatalogedTables(query: string) {
  return extractTableCandidates(query).filter((table) => !knownTables.has(table));
}

function requireDescribedTables(query: string) {
  return extractTableCandidates(query).filter((table) => !knownSchemas.has(table));
}

export const listTables = tool({
  ...listTablesDef,
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
    const tables = (await result.json()) as Array<{
      database: string;
      name: string;
      engine: string;
      total_rows: string;
      size: string;
    }>;
    registerCatalogTables(tables);
    return { tables };
  },
});

export const describeTable = tool({
  ...describeTableDef,
  execute: async ({ table }) => {
    const normalized = normalizeTableName(table);
    const [database, name] = normalized.includes(".") ? normalized.split(".", 2) : [undefined, normalized];
    const catalogKey = database ? `${database}.${name}` : name;
    if (!knownTables.has(catalogKey) && !knownTables.has(name)) {
      return {
        error: `Unknown table ${normalized}. Call listTables first, then describe a table that listTables returned.`,
      };
    }
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
    const columns = (await result.json()) as Array<{
      name: string;
      type: string;
      default_type?: string;
      default_expression?: string;
      comment?: string;
    }>;
    knownSchemas.set(catalogKey, columns.map((column) => `${column.name}:${column.type}`));
    knownSchemas.set(name, columns.map((column) => `${column.name}:${column.type}`));
    return { columns };
  },
});


export const runReadOnlyQuery = tool({
  ...runReadOnlyQueryDef,
  execute: async ({ query }) => {
    const normalizedQuery = normalizeUnionQuery(query);
    if (!READ_ONLY_STATEMENTS.test(normalizedQuery) || hasMultipleStatements(normalizedQuery)) {
      return {
        error: "Only one read-only SELECT-style statement is allowed.",
      };
    }

    try {
      const missingTables = requireCatalogedTables(normalizedQuery);
      if (missingTables.length > 0) {
        return {
          error: `Unknown table reference(s): ${missingTables.join(", ")}. Call listTables first, then describe the table(s) before writing SQL.`,
        };
      }
      const missingSchemas = requireDescribedTables(normalizedQuery);
      if (missingSchemas.length > 0) {
        return {
          error: `Undescribed table reference(s): ${missingSchemas.join(", ")}. Call describeTable on each table before writing SQL.`,
        };
      }
      const tables = extractTableCandidates(normalizedQuery);
      await ensureTablesExist(tables);
      const result = await getClickHouse().query({
        query: normalizedQuery,
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "2",
          max_result_rows: "1000",
          result_overflow_mode: "break",
          max_execution_time: 30,
          union_default_mode: "ALL",
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
  ...getDailyDigestDef,
  execute: async ({ noiseFloor }) => dailyDigest(noiseFloor),
});

export const getRealBuilders = tool({
  ...getRealBuildersDef,
  execute: async ({ window }) => realBuildersDeck(window),
});

export const getRepoDrilldown = tool({
  ...getRepoDrilldownDef,
  execute: async ({ repoName }) => repoDrilldown(repoName),
});

export const renderAnswer = tool({
  ...renderAnswerDef,
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

export const runDataRetrieval = tool({
  ...runDataRetrievalDef,
  execute: async ({ intent }) => runDataRetrievalAgent(intent),
});

export const runVisualizationMapping = tool({
  ...runVisualizationMappingDef,
  execute: async ({ intent, metadata }) => runVisualizationMappingAgent(intent, metadata),
});

export const attentionTools = {
  listTables,
  describeTable,
  runReadOnlyQuery,
  getDailyDigest,
  getRealBuilders,
  getRepoDrilldown,
  renderAnswer,
  runDataRetrieval,
  runVisualizationMapping,
};
