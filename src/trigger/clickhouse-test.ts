import { logger, task } from "@trigger.dev/sdk";
import { createClient } from "@clickhouse/client";

export const clickhouseTestTask = task({
  id: "clickhouse-test",
  maxDuration: 60,
  run: async (payload: { query?: string }) => {
    const clickhouse = createClient({
      url: process.env.CLICKHOUSE_URL,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE,
    });

    const query =
      payload.query ??
      "SELECT version() AS version, currentUser() AS user, now() AS server_time";

    const resultSet = await clickhouse.query({ query, format: "JSONEachRow" });
    const rows = await resultSet.json();

    logger.log("ClickHouse query result", { query, rows });

    await clickhouse.close();

    return { query, rows };
  },
});
