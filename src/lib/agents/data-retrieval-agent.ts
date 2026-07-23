import { generateObject } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@clickhouse/client";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let clickhouse: ReturnType<typeof createClient> | undefined;

function getClickHouse() {
  if (clickhouse) return clickhouse;

  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const username = process.env.CLICKHOUSE_USER ?? process.env.DB_USER ?? "default";
  const password = process.env.CLICKHOUSE_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  const database = process.env.CLICKHOUSE_DATABASE ?? "default";

  clickhouse = createClient({
    url,
    username,
    password,
    database,
    request_timeout: 30_000,
  });
  return clickhouse;
}

const READ_ONLY_STATEMENTS = /^\s*(select|with|show|describe|desc|explain|exists)\b/i;
// Bounded row sample returned to the calling model so it can populate a
// morphing-card payload's `data` field directly — previously this tool only
// returned column metadata, leaving the model with no rows to render and no
// path except a placeholder chart (issue #143/#144).
const MAX_SAMPLE_ROWS = 50;

function hasMultipleStatements(query: string) {
  return query.replace(/;+\s*$/, "").includes(";");
}

export async function runDataRetrievalAgent(intent: string) {
  // 1. Translate intent to SQL using LLM
  const { object } = await generateObject({
    model: openai("gpt-4o"),
    system: "You are the Data Retrieval Agent. Your job is to translate a user's semantic intent into a single optimized read-only ClickHouse SQL query. Only SELECT statements are allowed.",
    prompt: `Intent: ${intent}`,
    schema: z.object({
      query: z.string().describe("The read-only ClickHouse SQL query"),
    }),
  });

  const query = object.query;

  if (!READ_ONLY_STATEMENTS.test(query) || hasMultipleStatements(query)) {
    throw new Error("Only one read-only SELECT-style statement is allowed.");
  }

  // 2. Execute Query
  const result = await getClickHouse().query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "2",
      max_execution_time: 30,
      union_default_mode: "ALL",
    },
  });

  const rows = await result.json<Record<string, unknown>[]>();
  
  // 3. Persist raw result to a secure temporary storage layer
  const retrievalKey = randomUUID();
  const tempFilePath = path.join(os.tmpdir(), `clickhouse_result_${retrievalKey}.json`);
  await fs.writeFile(tempFilePath, JSON.stringify(rows), "utf-8");

  // 4. Compute schema metadata and summary statistics
  const metadata: Record<string, any> = {};
  if (rows.length > 0) {
    const sample = rows[0];
    for (const key of Object.keys(sample)) {
      const type = typeof (sample as any)[key];
      const values = rows.map((r) => (r as any)[key]);
      const uniqueValues = new Set(values);
      
      metadata[key] = {
        type,
        cardinality: uniqueValues.size,
      };

      if (type === "number") {
        const numValues = values as number[];
        const min = Math.min(...numValues);
        const max = Math.max(...numValues);
        metadata[key].min = min;
        metadata[key].max = max;
      }
    }
  }

  return {
    retrievalKey,
    rowCount: rows.length,
    metadata,
    queryExecuted: query,
    // Bounded sample the model can pass straight into a morphing-card
    // payload's `data` field (see runVisualizationMappingDef / MorphingCardSchema).
    sampleRows: rows.slice(0, MAX_SAMPLE_ROWS),
  };
}
