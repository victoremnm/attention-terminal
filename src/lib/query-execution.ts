import { randomUUID } from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  analyzeQueryAntipatterns,
  buildLogComment,
  formatAntipatternHint,
  type LogCommentTag,
} from "./query-antipatterns";

export interface TaggedQuerySettings {
  toolName: string;
  surface?: string;
  queryId?: string;
}

export interface ExecuteTaggedJsonEachRowOptions {
  queryId?: string;
  readonly?: string;
  maxExecutionTime?: number;
  maxResultRows?: string;
  resultOverflowMode?: "break" | "throw";
  queryParams?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  logComment?: TaggedQuerySettings;
}

export function normalizeUnionQuery(query: string): string {
  return query.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1|\bUNION\b(?!\s+(?:ALL|DISTINCT)\b)/gi, (match, quote) => {
    if (quote) return match;
    return "UNION ALL";
  });
}

export function blockAntipatternsIfPresent(query: string): string | null {
  const hits = analyzeQueryAntipatterns(query);
  return formatAntipatternHint(hits) || null;
}

export async function executeTaggedJsonEachRowQuery<T>(
  client: Pick<ClickHouseClient, "query">,
  query: string,
  options: ExecuteTaggedJsonEachRowOptions = {},
): Promise<{ rows: T[]; queryId: string; rowsRead: number; elapsedMs: number }> {
  const startedAt = Date.now();
  const queryId = options.queryId ?? randomUUID();
  const logComment = buildLogComment({
    ...(options.logComment ?? { toolName: "query" }),
    queryId,
  } satisfies LogCommentTag);
  const result = await client.query({
    query,
    format: "JSONEachRow",
    query_id: queryId,
    query_params: options.queryParams,
    abort_signal: options.abortSignal,
    clickhouse_settings: {
      readonly: options.readonly ?? "2",
      union_default_mode: "ALL",
      ...(options.maxExecutionTime ? { max_execution_time: options.maxExecutionTime } : {}),
      ...(options.maxResultRows ? { max_result_rows: options.maxResultRows } : {}),
      ...(options.resultOverflowMode ? { result_overflow_mode: options.resultOverflowMode } : {}),
      log_comment: logComment,
    },
  });

  const rows = await result.json<T>();
  let rowsRead = rows.length;
  try {
    const summary = (result as unknown as { response_headers?: Record<string, string | string[]> })
      .response_headers?.["x-clickhouse-summary"];
    if (summary) {
      const parsed = JSON.parse(String(summary)) as { read_rows?: string | number };
      const parsedRowsRead = Number(parsed.read_rows);
      if (Number.isFinite(parsedRowsRead)) rowsRead = parsedRowsRead;
    }
  } catch {
    // Use returned row count when ClickHouse does not expose its summary.
  }
  return { rows, queryId, rowsRead, elapsedMs: Date.now() - startedAt };
}
