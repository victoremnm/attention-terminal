import { createClient } from "@clickhouse/client";

const base = {
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
};

type Client = ReturnType<typeof createClient>;

function lazyClient(factory: () => Client): Client {
  let client: Client | undefined;
  return new Proxy({} as Client, {
    get(_, prop) {
      if (!client) client = factory();
      const value = (client as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
    },
  });
}

// Query/DDL client. Generous timeout because some statements make the server
// pull and parse remote files (GH Archive hourly loads run 30-120s).
export const clickhouse = lazyClient(() =>
  createClient({
    ...base,
    request_timeout: 180_000,
    clickhouse_settings: {
      // Keep the connection alive through load balancers during long
      // server-side pulls (e.g. GH Archive url() inserts).
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "20000",
    },
  })
);

// Insert client: server-side batching with flush acknowledgement. Retries are
// safe because hackernews is a ReplacingMergeTree and ingest_log is append-only.
export const clickhouseInsert = lazyClient(() =>
  createClient({
    ...base,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  })
);

function splitTableName(table: string) {
  const trimmed = table.trim();
  const parts = trimmed.split(".");
  if (parts.length === 2) {
    return { database: parts[0], name: parts[1] };
  }
  return { database: base.database, name: trimmed };
}

export async function missingTables(tables: string[]) {
  const uniqueTables = [...new Set(tables.map((table) => table.trim()).filter(Boolean))];
  if (uniqueTables.length === 0) return [];

  const missing: string[] = [];
  for (const table of uniqueTables) {
    const { database, name } = splitTableName(table);
    const result = await clickhouse.query({
      query: `
        SELECT 1 AS present
        FROM system.tables
        WHERE database = {database: String}
          AND name = {name: String}
        LIMIT 1
      `,
      format: "JSONEachRow",
      query_params: { database, name },
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    const rows = await result.json<{ present: number }>();
    if (rows.length === 0) missing.push(table);
  }

  return missing;
}

export async function missingColumns(table: string, columns: string[]) {
  const { database, name } = splitTableName(table);
  try {
    const result = await clickhouse.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = {database: String}
          AND table = {name: String}
          AND name IN ({columns: Array(String)})
      `,
      format: "JSONEachRow",
      query_params: { database, name, columns },
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    const rows = await result.json<{ name: string }>();
    const found = new Set(rows.map((r) => r.name));
    return columns.filter((col) => !found.has(col));
  } catch {
    return columns;
  }
}

export async function ensureTablesExist(tables: string[]) {
  const missing = await missingTables(tables);

  if (missing.length > 0) {
    throw new Error(`Missing ClickHouse table(s): ${missing.join(", ")}. Run the migration or update the query to a known table.`);
  }
}

export async function selectRows<T>(query: string): Promise<T[]> {
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  return result.json<T>();
}

export async function logIngest(entry: {
  source: string;
  chunk_key: string;
  rows_ingested: number;
  watermark?: number;
}) {
  await clickhouseInsert.insert({
    table: "ingest_log",
    values: [{ watermark: 0, ...entry }],
    format: "JSONEachRow",
  });
}
