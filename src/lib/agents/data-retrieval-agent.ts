import { generateObject } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@clickhouse/client";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { blockAntipatternsIfPresent, executeTaggedJsonEachRowQuery, normalizeUnionQuery } from "../query-execution";
import {
  FALLBACK_TABLES,
  LIST_TABLES_SQL,
  TABLE_LIST_LIMIT,
  registerCatalogTables,
  requireCatalogedTables,
  requireFinalOnReplacingTables,
  requireGroupedRollupTables,
} from "../sql-catalog-guard";

export { normalizeUnionQuery } from "../query-execution";

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

// Bounded row sample returned to the calling model so it can populate a
// morphing-card payload's `data` field directly — previously this tool only
// returned column metadata, leaving the model with no rows to render and no
// path except a placeholder chart (issue #143/#144).
const MAX_SAMPLE_ROWS = 50;

// This sub-agent has no tool-calling ability of its own (generateObject only,
// no listTables/describeTable step), and it's a *sanctioned* alternate path
// the top-level agent can call directly for ad-hoc questions (see
// agent-prompt.ts) — so it must ground and validate itself rather than
// relying on the top-level agent's catalog. Bounded to keep latency sane;
// each failed attempt feeds the concrete error back so the model corrects
// itself instead of repeating the same fabrication.
const MAX_ATTEMPTS = 3;
const CATALOG_TIMEOUT_MS = 5_000;

function hasMultipleStatements(query: string) {
  return query.replace(/;+\s*$/, "").includes(";");
}

type CatalogTable = { database: string; name: string; engine: string };

async function loadCatalog(): Promise<{ tables: CatalogTable[]; referenceText: string }> {
  try {
    const { rows: tables } = await executeTaggedJsonEachRowQuery<CatalogTable>(getClickHouse(), LIST_TABLES_SQL, {
      queryParams: { limit: TABLE_LIST_LIMIT },
      abortSignal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      maxExecutionTime: 5,
      logComment: { toolName: "runDataRetrieval", surface: "catalog" },
    });
    registerCatalogTables(tables);
    return { tables, referenceText: formatCatalogReference(tables) };
  } catch {
    registerCatalogTables(FALLBACK_TABLES);
    return { tables: FALLBACK_TABLES, referenceText: formatCatalogReference(FALLBACK_TABLES) };
  }
}

function formatCatalogReference(tables: CatalogTable[]): string {
  return tables
    .map((t) => `- ${t.database}.${t.name}${/Replacing/i.test(t.engine) ? " (ReplacingMergeTree -- requires FINAL)" : ""}`)
    .join("\n");
}

const querySchema = z.object({
  query: z.string().describe("The read-only ClickHouse SQL query"),
});

export async function runDataRetrievalAgent(intent: string): Promise<
  | {
      retrievalKey: string;
      rowCount: number;
      metadata: Record<string, unknown>;
      queryExecuted: string;
      sampleRows: Record<string, unknown>[];
    }
  | { error: string }
> {
  const { referenceText } = await loadCatalog();

  const instructions = `You are the Data Retrieval Agent. Your job is to translate a user's semantic intent into a single optimized read-only ClickHouse SQL query. Only SELECT statements are allowed. Always use explicit UNION ALL or UNION DISTINCT instead of bare UNION.

Only reference tables from this catalog — never invent a table or column name:
${referenceText}

CORE TABLE COLUMNS (Use EXACT column names):
- raw.github_events & default.github_events:
  Columns: created_at (DateTime), event_type (String), repo_name (String), actor_login (String), action (String), ref_type (String), commit_count (UInt16), distinct_commit_count (UInt16), pr_merged (UInt8).
  NOTE: Time column is created_at (NOT event_time or event_date). Use commit_count or distinct_commit_count (NOT commits) for commit counts on github_events. There is NO repo_description column on github_events.

- default.gh_repo_activity_feed:
  Columns: created_at (DateTime), repo_name (String), actor_login (String), event_type (String), action (String), commits (UInt32), title (String).
  NOTE: Time column is created_at (NOT event_time or event_date).

- default.gh_repo_metadata (ReplacingMergeTree -- requires FINAL):
  Columns: repo_name (String), owner (String), description (String), language (String), topics (Array(String)), github_stars (UInt64), fetched_at (DateTime).
  NOTE: To search repo descriptions or topics, query or JOIN default.gh_repo_metadata FINAL on repo_name.

- default.gh_repo_daily & default.gh_actor_daily:
  Columns: day (Date), repo_name (String), pushes (UInt32), commits (UInt32), stars (UInt32), forks (UInt32), prs_opened (UInt32), prs_merged (UInt32).
  NOTE: gh_repo_daily stores ONE ROW PER DAY. When querying across a time range (e.g. day >= today() - 7), you MUST use GROUP BY repo_name and aggregate metrics with SUM(stars), SUM(pushes), SUM(commits), etc. Never SELECT repo_name, stars directly without GROUP BY repo_name, or duplicate daily rows for the same repo will be returned!

- raw.hackernews & default.hackernews (ReplacingMergeTree -- requires FINAL):
  Columns: id (UInt64), by (String), time (DateTime), title (String), url (String), score (UInt32), type (String).
  NOTE: Time column is time (DateTime).

Any table marked "(ReplacingMergeTree -- requires FINAL)" can hold duplicate/stale-version rows until a background merge runs -- always add FINAL after the table name (and after any alias, e.g. FROM hackernews FINAL or FROM gh_repo_metadata AS m FINAL) or the result will contain the same logical row more than once.

If you are unsure whether a column exists on a table, prefer a simpler query over guessing a column name.`;

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: `Intent: ${intent}` },
  ];

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (lastError) {
      messages.push({
        role: "user",
        content: `That query was rejected: ${lastError}\nWrite a corrected query using only tables from the catalog above.`,
      });
    }

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      instructions,
      messages,
      schema: querySchema,
    });
    messages.push({ role: "assistant", content: JSON.stringify(object) });

    const query = normalizeUnionQuery(object.query);

    if (!/^\s*(select|with|show|describe|desc|explain|exists)\b/i.test(query) || hasMultipleStatements(query)) {
      lastError = "Only one read-only SELECT-style statement is allowed.";
      continue;
    }
    const antipatternHint = blockAntipatternsIfPresent(query);
    if (antipatternHint) {
      lastError = antipatternHint;
      continue;
    }

    const missingTables = requireCatalogedTables(query);
    if (missingTables.length > 0) {
      lastError = `Unknown table reference(s): ${missingTables.join(", ")}. These tables do not exist.`;
      continue;
    }

    const missingFinal = requireFinalOnReplacingTables(query);
    if (missingFinal.length > 0) {
      lastError = `Table(s) missing FINAL: ${missingFinal.join(", ")}. These are ReplacingMergeTree tables and can contain duplicate/stale-version rows without it -- add FINAL after the alias (e.g. FROM ${missingFinal[0]} AS m FINAL). FINAL must come after any alias, never before it.`;
      continue;
    }

    const missingGroup = requireGroupedRollupTables(query);
    if (missingGroup.length > 0) {
      lastError = `Rollup table(s) missing GROUP BY: ${missingGroup.join(", ")}. Periodic rollup tables store one row per day/hour -- querying across a time range without GROUP BY produces duplicate rows per entity. Add GROUP BY repo_name (or actor_login) and aggregate metrics with SUM(stars), SUM(pushes), etc.`;
      continue;
    }

    try {
      const { rows } = await executeTaggedJsonEachRowQuery<Record<string, unknown>>(getClickHouse(), query, {
        readonly: "2",
        maxExecutionTime: 30,
        logComment: { toolName: "runDataRetrieval", surface: "ad-hoc-intent" },
      });

      // Persist raw result to a secure temporary storage layer
      const retrievalKey = randomUUID();
      const tempFilePath = path.join(os.tmpdir(), `clickhouse_result_${retrievalKey}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(rows), "utf-8");

      // Compute schema metadata and summary statistics
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
        // payload's chartConfig.data.values (see MorphingCardSchema in render-payload.ts).
        sampleRows: rows.slice(0, MAX_SAMPLE_ROWS),
      };
    } catch (error) {
      const rawErr = error instanceof Error ? error.message : String(error);
      if (/unknown (expression|function identifier|identifier)/i.test(rawErr) || rawErr.includes("47")) {
        lastError = `${rawErr}\nHINT: Verify column names against table schemas above: on github_events, commit count is 'commit_count' or 'distinct_commit_count' (NOT 'commits'); time column is 'created_at' on github_events and gh_repo_activity_feed (NOT 'event_time' or 'event_date'), 'time' on hackernews, and 'day' on gh_repo_daily. Repo descriptions are in 'gh_repo_metadata.description' (JOIN default.gh_repo_metadata FINAL ON repo_name).`;
      } else {
        lastError = rawErr;
      }
    }
  }

  return { error: `Failed to produce a valid query after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}` };
}
