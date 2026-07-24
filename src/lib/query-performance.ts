import { analyzeQueryAntipatterns, parseLogComment } from "./query-antipatterns";
import { clickhouse, missingColumns, missingTables } from "./clickhouse";

export interface QueryPerformanceRow {
  event_time: string;
  query_id: string;
  query_type: string;
  log_comment: string;
  query: string;
  query_duration_ms: number;
  read_rows: number;
  read_bytes: number;
  result_rows: number;
  memory_usage: number;
  rows_per_second: number;
  attention_tag: string;
  antipatterns: string[];
}

export interface QueryPerformanceSummary {
  queryCount: number;
  attentionTaggedCount: number;
  avgDurationMs: number;
  totalReadRows: number;
  totalReadBytes: number;
  slowestDurationMs: number;
}

export interface QueryPerformancePayload {
  rows: QueryPerformanceRow[];
  summary: QueryPerformanceSummary;
  provenance: {
    sql: string;
    elapsedMs: number;
    tables: string[];
  };
}

function truncateQuery(query: string, maxLength = 220) {
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function presentColumns(columns: string[], missing: string[]) {
  const missingSet = new Set(missing);
  return columns.filter((column) => !missingSet.has(column));
}

function selectNumeric(column: string, alias: string, available: ReadonlySet<string>): string {
  return available.has(column) ? `toUInt64(${column}) AS ${alias}` : `toUInt64(0) AS ${alias}`;
}

function selectString(column: string, alias: string, available: ReadonlySet<string>): string {
  return available.has(column) ? `toString(${column}) AS ${alias}` : `'' AS ${alias}`;
}

function summarizeRows(rows: QueryPerformanceRow[]): QueryPerformanceSummary {
  const queryCount = rows.length;
  const attentionTaggedCount = rows.filter((row) => row.attention_tag.length > 0).length;
  const totalReadRows = rows.reduce((sum, row) => sum + row.read_rows, 0);
  const totalReadBytes = rows.reduce((sum, row) => sum + row.read_bytes, 0);
  const totalDuration = rows.reduce((sum, row) => sum + row.query_duration_ms, 0);
  const slowestDurationMs = rows.reduce((max, row) => Math.max(max, row.query_duration_ms), 0);
  return {
    queryCount,
    attentionTaggedCount,
    avgDurationMs: queryCount > 0 ? Math.round(totalDuration / queryCount) : 0,
    totalReadRows,
    totalReadBytes,
    slowestDurationMs,
  };
}

export function summarizeQueryPerformanceForTest(rows: QueryPerformanceRow[]): QueryPerformanceSummary {
  return summarizeRows(rows);
}

export async function fetchQueryPerformanceData(): Promise<QueryPerformancePayload> {
  const start = performance.now();
  const missingQueryLog = await missingTables(["system.query_log"]);

  if (missingQueryLog.length > 0) {
    return {
      rows: [],
      summary: {
        queryCount: 0,
        attentionTaggedCount: 0,
        avgDurationMs: 0,
        totalReadRows: 0,
        totalReadBytes: 0,
        slowestDurationMs: 0,
      },
      provenance: {
        sql: "SELECT * FROM system.query_log",
        elapsedMs: Math.round(performance.now() - start),
        tables: ["system.query_log"],
      },
    };
  }

  const missingQueryColumns = await missingColumns("system.query_log", [
    "event_date",
    "event_time",
    "query_id",
    "query",
    "log_comment",
    "type",
    "query_duration_ms",
    "read_rows",
    "read_bytes",
    "result_rows",
    "memory_usage",
  ]);

  const availableColumns = new Set(
    presentColumns(
      [
      "event_time",
      "event_date",
      "query_id",
      "query",
      "log_comment",
        "type",
        "query_duration_ms",
        "read_rows",
        "read_bytes",
        "result_rows",
        "memory_usage",
      ],
      missingQueryColumns,
    ),
  );

  const sql = `
    SELECT
      ${selectString("event_time", "event_time", availableColumns)},
      ${selectString("query_id", "query_id", availableColumns)},
      ${selectString("type", "query_type", availableColumns)},
      ${selectString("log_comment", "log_comment", availableColumns)},
      ${selectString("query", "query", availableColumns)},
      ${selectNumeric("query_duration_ms", "query_duration_ms", availableColumns)},
      ${selectNumeric("read_rows", "read_rows", availableColumns)},
      ${selectNumeric("read_bytes", "read_bytes", availableColumns)},
      ${selectNumeric("result_rows", "result_rows", availableColumns)},
      ${selectNumeric("memory_usage", "memory_usage", availableColumns)}
    FROM system.query_log
    WHERE ${availableColumns.has("event_date") ? "event_date >= today() - 1" : "1 = 1"}
      AND ${availableColumns.has("type") ? "type = 'QueryFinish'" : "1 = 1"}
    ORDER BY event_time DESC
    LIMIT 30
  `.trim();

  const result = await clickhouse.query({
    query: sql,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "2",
      max_execution_time: 10,
    },
  });
  const rawRows = await result.json<Record<string, unknown>>();

  const rows: QueryPerformanceRow[] = rawRows.map((row) => {
    const query = String(row.query ?? "");
    const parsedLogComment = parseLogComment(typeof row.log_comment === "string" ? row.log_comment : "");
    const hits = analyzeQueryAntipatterns(query);
    const antipatterns = hits.map((hit) => hit.id);
    const queryDurationMs = toNumber(row.query_duration_ms);
    const readRows = toNumber(row.read_rows);
    const readBytes = toNumber(row.read_bytes);
    return {
      event_time: String(row.event_time ?? ""),
      query_id: String(row.query_id ?? ""),
      query_type: String(row.query_type ?? ""),
      log_comment: parsedLogComment.raw,
      query: truncateQuery(query),
      query_duration_ms: queryDurationMs,
      read_rows: readRows,
      read_bytes: readBytes,
      result_rows: toNumber(row.result_rows),
      memory_usage: toNumber(row.memory_usage),
      rows_per_second: queryDurationMs > 0 ? Math.round((readRows / queryDurationMs) * 1000) : readRows,
      attention_tag: parsedLogComment.isAttentionQuery
        ? [parsedLogComment.toolName, parsedLogComment.surface].filter(Boolean).join(" · ")
        : "",
      antipatterns,
    };
  });

  return {
    rows,
    summary: summarizeRows(rows),
    provenance: {
      sql,
      elapsedMs: Math.round(performance.now() - start),
      tables: ["system.query_log"],
    },
  };
}

export function queryPerformanceHeaderLabel(row: QueryPerformanceRow) {
  return row.attention_tag || row.query_type || "Query";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
