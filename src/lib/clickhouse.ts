import { createClient } from "@clickhouse/client";

const base = {
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
};

type Client = ReturnType<typeof createClient>;

export interface ClickHouseClientHolder<TClient> {
  get: () => TClient;
  proxy: TClient;
  reset: () => Promise<void>;
}

function lazyClient(factory: () => Client): ClickHouseClientHolder<Client> {
  let client: Client | undefined;
  const get = () => {
    if (!client) client = factory();
    return client;
  };
  const reset = async () => {
    const staleClient = client;
    client = undefined;
    await staleClient?.close().catch(() => undefined);
  };
  const proxy = new Proxy({} as Client, {
    get(_, prop) {
      const currentClient = get();
      const value = (currentClient as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(currentClient) : value;
    },
  });
  return { get, proxy, reset };
}

const QUERY_RETRY_DELAYS_MS = [250, 1_000] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientClickHouseNetworkError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "");
  const cause = candidate?.cause instanceof Error ? candidate.cause.message : String(candidate?.cause ?? "");
  const details = `${code} ${message} ${cause}`.toUpperCase();

  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENETUNREACH",
    "EAI_AGAIN",
    "CLIENT NETWORK SOCKET DISCONNECTED",
    "SOCKET HANG UP",
  ].some((marker) => details.includes(marker));
}

export async function withClickHouseRetry<TClient, TResult>(
  holder: ClickHouseClientHolder<TClient>,
  operation: (client: TClient) => Promise<TResult>,
  operationName: string,
  retryDelaysMs: readonly number[] = QUERY_RETRY_DELAYS_MS
): Promise<TResult> {
  let lastError: unknown;
  const attempts = retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(holder.get());
    } catch (error) {
      lastError = error;
      if (!isTransientClickHouseNetworkError(error) || attempt === attempts) throw error;

      console.warn("[clickhouse] transient network error; reconnecting", {
        operation: operationName,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      await holder.reset();
      await sleep(retryDelaysMs[attempt - 1]);
    }
  }

  throw lastError;
}

// Query/DDL client. Generous timeout because some statements make the server
// pull and parse remote files (GH Archive hourly loads run 30-120s).
const queryClient = lazyClient(() =>
  createClient({
    ...base,
    request_timeout: 180_000,
    max_open_connections: 2,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 2_000,
      eagerly_destroy_stale_sockets: true,
    },
    clickhouse_settings: {
      // Keep the connection alive through load balancers during long
      // server-side pulls (e.g. GH Archive url() inserts).
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "20000",
    },
  })
);
export const clickhouse = queryClient.proxy;

// Insert client: server-side batching with flush acknowledgement. Retries are
// deliberately opt-in through insertRows below because a lost connection can
// happen after ClickHouse accepts an INSERT, which would duplicate append-only
// rows if every insert were retried automatically.
const insertClient = lazyClient(() =>
  createClient({
    ...base,
    request_timeout: 180_000,
    max_open_connections: 2,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 2_000,
      eagerly_destroy_stale_sockets: true,
    },
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  })
);
export const clickhouseInsert = insertClient.proxy;

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
  const uniqueColumns = [...new Set(columns.map((column) => column.trim()).filter(Boolean))];
  if (uniqueColumns.length === 0) return [];

  const { database, name } = splitTableName(table);
  try {
    const result = await clickhouse.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = {database: String}
          AND table = {table: String}
          AND name IN {columns: Array(String)}
      `,
      format: "JSONEachRow",
      query_params: { database, table: name, columns: uniqueColumns },
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    const rows = await result.json<{ name: string }>();
    const present = new Set(rows.map((row) => row.name));
    return uniqueColumns.filter((column) => !present.has(column));
  } catch {
    // If schema introspection is unavailable, use the legacy-safe literals.
    return uniqueColumns;
  }
}

export async function ensureTablesExist(tables: string[]) {
  const missing = await missingTables(tables);

  if (missing.length > 0) {
    throw new Error(`Missing ClickHouse table(s): ${missing.join(", ")}. Run the migration or update the query to a known table.`);
  }
}

export async function selectRows<T>(query: string): Promise<T[]> {
  return withClickHouseRetry(
    queryClient,
    async (client) => {
      const result = await client.query({ query, format: "JSONEachRow" });
      return result.json<T>();
    },
    "query"
  );
}

/**
 * Retry an INSERT only when the caller has idempotent semantics for it. A
 * ReplacingMergeTree keyed by actor_login is safe for refresh-actor-pr-stats.
 */
export async function insertRows(params: Parameters<Client["insert"]>[0]) {
  return withClickHouseRetry(insertClient, (client) => client.insert(params), "insert");
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
