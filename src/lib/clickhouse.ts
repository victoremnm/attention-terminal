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
