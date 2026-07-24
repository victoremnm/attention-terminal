import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { tool } from "ai";
import {
  buildMorphingCardDef,
  buildTablePayloadDef,
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
import {
  extractTableCandidates,
  FALLBACK_TABLES,
  hasKnownTable,
  LIST_TABLES_SQL,
  normalizeTableName,
  registerCatalogTables,
  registerTableSchema,
  requireCatalogedTables,
  requireDescribedTables,
  requireFinalOnReplacingTables,
  TABLE_LIST_LIMIT,
} from "./sql-catalog-guard";
import {
  blockAntipatternsIfPresent,
  executeTaggedJsonEachRowQuery,
  normalizeUnionQuery,
} from "./query-execution";

import { getDataPolicyTier } from "./catalog";

export { FALLBACK_TABLES, LIST_TABLES_SQL, TABLE_LIST_LIMIT };
import { dailyDigest } from "./digest";
import { realBuildersDeck } from "./real-builders";
import { RenderPayloadSchema } from "./render-payload";
import { repoDrilldown } from "./queries";
import { runDataRetrievalAgent } from "./agents/data-retrieval-agent";
import { runVisualizationMappingAgent } from "./agents/visualization-mapping-agent";

let clickhouse: ClickHouseClient | undefined;
let tableListClickhouse: ClickHouseClient | undefined;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const TABLE_LIST_TIMEOUT_MS = 5_000;

function createClickHouse(requestTimeoutMs: number): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER ?? process.env.DB_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
    request_timeout: requestTimeoutMs,
  });
}

function getClickHouse(): ClickHouseClient {
  if (clickhouse) return clickhouse;

  clickhouse = createClickHouse(DEFAULT_REQUEST_TIMEOUT_MS);
  return clickhouse;
}

function getTableListClickHouse(): ClickHouseClient {
  if (tableListClickhouse) return tableListClickhouse;

  tableListClickhouse = createClickHouse(TABLE_LIST_TIMEOUT_MS);
  return tableListClickhouse;
}

const READ_ONLY_STATEMENTS = /^\s*(select|with|show|describe|desc|explain|exists)\b/i;
const MAX_OUTPUT_CHARS = 50_000;

export { resetCatalogState } from "./sql-catalog-guard";

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
  ...listTablesDef,
  execute: async () => {
    const t0 = Date.now();
    try {
      const { rows: tablesRaw } = await executeTaggedJsonEachRowQuery<{
        database: string;
        name: string;
        engine: string;
        total_rows: string;
        size: string;
      }>(getTableListClickHouse(), LIST_TABLES_SQL, {
        queryParams: { limit: TABLE_LIST_LIMIT },
        abortSignal: AbortSignal.timeout(TABLE_LIST_TIMEOUT_MS),
        maxExecutionTime: 5,
        logComment: { toolName: "listTables", surface: "catalog" },
      });
      const elapsedMs = Date.now() - t0;
      registerCatalogTables(tablesRaw);
      const tables = tablesRaw.map((t) => ({
        ...t,
        data_policy: getDataPolicyTier(t.database),
      }));
      return {
        tables,
        provenance: {
          sql: LIST_TABLES_SQL,
          elapsedMs,
          rowsReturned: tables.length,
          tables: ["system.tables"],
        },
      };
    } catch {
      const elapsedMs = Date.now() - t0;
      registerCatalogTables(FALLBACK_TABLES);
      const tables = FALLBACK_TABLES.map((t) => ({
        ...t,
        data_policy: getDataPolicyTier(t.database),
      }));
      return {
        tables,
        isFallback: true,
        note: "ClickHouse system.tables query failed or timed out. Defaulting to safe catalog fallback.",
        provenance: {
          sql: LIST_TABLES_SQL,
          elapsedMs,
          rowsReturned: 0,
          tables: ["system.tables"],
        },
      };
    }
  },
});

export const describeTable = tool({
  ...describeTableDef,
  execute: async ({ table }) => {
    const normalized = normalizeTableName(table);
    const [database, name] = normalized.includes(".") ? normalized.split(".", 2) : [undefined, normalized];
    const catalogKey = database ? `${database}.${name}` : name;
    if (!hasKnownTable(catalogKey) && !hasKnownTable(name)) {
      return {
        error: `Unknown table ${normalized}. Call listTables first, then describe a table that listTables returned.`,
      };
    }
    const { rows: columns } = await executeTaggedJsonEachRowQuery<{
      name: string;
      type: string;
      default_type?: string;
      default_expression?: string;
      comment?: string;
    }>(
      getClickHouse(),
      database
        ? "DESCRIBE TABLE {database: Identifier}.{name: Identifier}"
        : "DESCRIBE TABLE {name: Identifier}",
      {
        queryParams: { database, name },
        maxExecutionTime: 10,
        logComment: { toolName: "describeTable", surface: "catalog" },
      },
    );
    registerTableSchema(catalogKey, columns.map((column) => `${column.name}:${column.type}`));
    registerTableSchema(name, columns.map((column) => `${column.name}:${column.type}`));
    return {
      columns,
      data_policy: getDataPolicyTier(database ?? "default"),
    };
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
    const antipatternHint = blockAntipatternsIfPresent(normalizedQuery);
    if (antipatternHint) {
      return { error: antipatternHint };
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
      const missingFinal = requireFinalOnReplacingTables(normalizedQuery);
      if (missingFinal.length > 0) {
        return {
          error: `Table(s) missing FINAL: ${missingFinal.join(", ")}. These are ReplacingMergeTree tables and can contain duplicate/stale-version rows without it -- add FINAL immediately after the table name (e.g. FROM ${missingFinal[0]} FINAL) and retry.`,
        };
      }
      const tables = extractTableCandidates(normalizedQuery);
      await ensureTablesExist(tables);
      const { rows } = await executeTaggedJsonEachRowQuery<Record<string, unknown>>(getClickHouse(), normalizedQuery, {
        readonly: "2",
        maxExecutionTime: 30,
        maxResultRows: "1000",
        resultOverflowMode: "break",
        logComment: { toolName: "runReadOnlyQuery", surface: "read-only-query" },
      });
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

// morphing-card's chartConfig is a permissive z.record(string, unknown()) --
// deliberately loose so it can carry an arbitrary Vega-Lite-ish shape, which
// means Zod alone can't catch an empty/malformed chartConfig.data.values.
// This is a real failure mode observed in live testing: the model
// hand-constructing a wrong shape (chartConfig.data.fields instead of
// .values, or omitting data.values entirely) passes RenderPayloadSchema fine
// but renders an empty table. Reject it here the same way a schema failure
// is rejected, so the model sees a concrete error and retries instead of the
// user silently seeing "no tabular values were provided for this chart".
function morphingCardDataError(payload: { type: string; chartConfig?: unknown }): string | null {
  if (payload.type !== "morphing-card") return null;
  const config = payload.chartConfig as Record<string, unknown> | undefined;
  const data = config && typeof config === "object" ? (config.data as Record<string, unknown> | undefined) : undefined;
  const values = data && typeof data === "object" ? data.values : undefined;
  if (!Array.isArray(values) || values.length === 0) {
    return "chartConfig.data.values must be a non-empty array of row objects (use the buildMorphingCard tool instead of hand-constructing chartConfig, or set chartConfig.data.values directly to your rows).";
  }
  if (!values.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    return "chartConfig.data.values must contain row objects (not arrays or primitives) -- each entry should be a record like { field: value, ... }.";
  }
  return null;
}

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
    const dataError = morphingCardDataError(parsed.data);
    if (dataError) {
      return {
        ok: false,
        errors: [dataError],
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

function humanizeColumnKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export const buildMorphingCard = tool({
  ...buildMorphingCardDef,
  execute: async ({ rows, columns, visualizationType, summary, query }) => {
    const resolvedColumns =
      columns ?? Object.keys(rows[0] ?? {}).map((field) => ({ field, title: humanizeColumnKey(field) }));
    return {
      type: "morphing-card" as const,
      visualizationType,
      generatedAt: new Date().toISOString(),
      chartConfig: {
        data: { values: rows },
        encoding: { tooltip: resolvedColumns },
      },
      summary,
      query,
    };
  },
});

export const buildTablePayload = tool({
  ...buildTablePayloadDef,
  execute: async ({ columns, rows, totals, summary, query }) => {
    return {
      type: "table" as const,
      columns,
      rows,
      totals,
      summary,
      query,
    };
  },
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
  buildMorphingCard,
  buildTablePayload,
};
