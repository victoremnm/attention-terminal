import { clickhouse, ensureTablesExist } from "../clickhouse";
import type { Provenance, QueryResult } from "./types";

interface QueryRequest {
  tablesReady: Promise<void>;
}

export async function q<T>(
  sql: string,
  tables: string[],
  query_params?: Record<string, unknown>,
  request?: QueryRequest
): Promise<{ rows: T[]; provenance: Provenance }> {
  await (request?.tablesReady ?? ensureTablesExist(tables));
  const t0 = Date.now();
  const rs = await clickhouse.query({
    query: sql,
    format: "JSONEachRow",
    query_params,
    clickhouse_settings: {
      readonly: "2",
      max_execution_time: 30,
      union_default_mode: "ALL",
    },
  });
  const rows = await rs.json<T>();
  const elapsedMs = Date.now() - t0;
  let rowsRead: number | undefined;
  try {
    const summary = (rs as unknown as { response_headers?: Record<string, string | string[]> })
      .response_headers?.["x-clickhouse-summary"];
    if (summary) rowsRead = Number(JSON.parse(String(summary)).read_rows);
  } catch {
    // provenance stays partial; never block the answer on it
  }
  return { rows, provenance: { sql: sql.trim(), elapsedMs, rowsRead, tables } };
}

export function toQueryResult<T>(data: T, provenance: Provenance): QueryResult<T> {
  return { data, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}

export function valueOf(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

export function stat(label: string, value: string | number, tone?: "hot" | "muted") {
  return { label, value: String(value), ...(tone ? { tone } : {}) };
}

export function activityDelta(parts: Array<[string, string | number]>) {
  const visible = parts
    .filter(([, value]) => valueOf(value) > 0)
    .map(([label, value]) => `${value} ${label}`);
  return visible.length ? visible.join(" · ") : undefined;
}
