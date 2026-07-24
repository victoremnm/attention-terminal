// Shared table/column existence guard for any code path that executes
// LLM-generated SQL against ClickHouse. Extracted from agent-tools.ts so
// runReadOnlyQuery and runDataRetrievalAgent (two independent
// generate-then-execute paths) validate against one source of truth instead
// of drifting apart -- see docs/architecture/CHAT-AGENT-QUERY-FLOW.md.

export type CatalogTableRef = { database: string; name: string; engine?: string };

// Matches ReplacingMergeTree and its Shared/Replicated variants (ClickHouse
// Cloud reports engines like "SharedReplacingMergeTree") -- anything with
// "Replacing" in the engine name needs FINAL to collapse duplicate/stale
// versions, or a query can return the same logical row multiple times with
// different snapshots of its mutable columns.
const REPLACING_ENGINE_PATTERN = /Replacing/i;

export const FALLBACK_TABLES = [
  { database: "curated", name: "task_execution_metrics", engine: "View", total_rows: "estimated", size: "N/A" },
  { database: "curated", name: "task_health_summary", engine: "View", total_rows: "estimated", size: "N/A" },
  { database: "cleansed", name: "github_events_cleansed", engine: "View", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_hourly", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_actor_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_activity_feed", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_analysis", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "raw", name: "github_events", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "internal", name: "trigger_task_logs", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "internal", name: "subagent_runs", engine: "View", total_rows: "estimated", size: "N/A" },
];

export const TABLE_LIST_LIMIT = 50;

export const LIST_TABLES_SQL = `
  SELECT database, name, engine, total_rows, formatReadableSize(total_bytes) AS size
  FROM system.tables
  WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
  ORDER BY
    CASE database
      WHEN 'curated' THEN 1
      WHEN 'cleansed' THEN 2
      WHEN 'default' THEN 3
      WHEN 'raw' THEN 4
      WHEN 'internal' THEN 5
      ELSE 6
    END,
    name
  LIMIT {limit: UInt32}
`.trim();

const knownTables = new Set<string>();
const knownSchemas = new Map<string, string[]>();
const knownEngines = new Map<string, string>();
// Keyed by bare table name (no database prefix) -> every engine seen for
// that name across all databases. A view (e.g. raw.hackernews) and its
// underlying table (default.hackernews) share a bare name but report
// different engines from system.tables ("View" vs "ReplacingMergeTree") --
// this lets isReplacingMergeTree see through the view to the real engine
// regardless of which qualified name a query actually uses, and regardless
// of catalog registration order.
const knownEnginesByBareName = new Map<string, Set<string>>();

export function resetCatalogState() {
  knownTables.clear();
  knownSchemas.clear();
  knownEngines.clear();
  knownEnginesByBareName.clear();
}

function bareName(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? name : name.slice(idx + 1);
}

export function registerCatalogTables(tables: CatalogTableRef[]) {
  for (const table of tables) {
    knownTables.add(`${table.database}.${table.name}`);
    knownTables.add(table.name);
    if (table.engine) {
      knownEngines.set(`${table.database}.${table.name}`, table.engine);
      knownEngines.set(table.name, table.engine);
      if (!knownEnginesByBareName.has(table.name)) knownEnginesByBareName.set(table.name, new Set());
      knownEnginesByBareName.get(table.name)!.add(table.engine);
    }
  }
}

export function isReplacingMergeTree(name: string): boolean {
  const engines = knownEnginesByBareName.get(bareName(name));
  if (engines) {
    for (const engine of engines) {
      if (REPLACING_ENGINE_PATTERN.test(engine)) return true;
    }
  }
  const engine = knownEngines.get(name);
  return Boolean(engine && REPLACING_ENGINE_PATTERN.test(engine));
}

export function registerTableSchema(key: string, columns: string[]) {
  knownSchemas.set(key, columns);
}

export function isCatalogLoaded(): boolean {
  return knownTables.size > 0;
}

export function hasKnownTable(name: string): boolean {
  return knownTables.has(name);
}

export function hasDescribedTable(name: string): boolean {
  return knownSchemas.has(name);
}

export function normalizeTableName(table: string): string {
  return table.trim().replace(/`/g, "").replace(/"/g, "");
}

function getCteNames(query: string): Set<string> {
  const cteNames = new Set<string>();
  for (const match of query.matchAll(/\b([A-Za-z_][\w$]*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1]);
  }
  return cteNames;
}

export function extractTableCandidates(query: string): string[] {
  const cteNames = getCteNames(query);

  const refs = new Set<string>();
  for (const match of query.matchAll(/\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?/gi)) {
    const table = match[4] ? `${match[2]}.${match[4]}` : match[2];
    if (!cteNames.has(match[2])) refs.add(normalizeTableName(table));
  }

  return [...refs];
}

/** Table references in `query` that are not in the live catalog. Empty means every referenced table exists. */
export function requireCatalogedTables(query: string): string[] {
  return extractTableCandidates(query).filter((table) => !knownTables.has(table));
}

/** Table references in `query` whose column schema hasn't been fetched via describeTable yet. */
export function requireDescribedTables(query: string): string[] {
  return extractTableCandidates(query).filter((table) => !knownSchemas.has(table));
}

/**
 * ReplacingMergeTree (and Shared/Replicated variant) tables referenced in
 * `query` without a FINAL modifier immediately after the table name. Empty
 * means every ReplacingMergeTree reference is correctly deduplicated.
 * Requires the catalog to be loaded (registerCatalogTables) with engine
 * info -- tables of unknown engine are assumed safe rather than flagged, so
 * this only fires on a confirmed ReplacingMergeTree. Sees through views
 * (isReplacingMergeTree checks every engine registered under the same bare
 * table name, so `raw.hackernews` -- a View over `default.hackernews`, a
 * ReplacingMergeTree -- still requires FINAL). CTE references are excluded:
 * a CTE that already reads its source table with FINAL doesn't need the
 * outer query to repeat it.
 */
export function requireFinalOnReplacingTables(query: string): string[] {
  const cteNames = getCteNames(query);
  const missing = new Set<string>();
  for (const match of query.matchAll(
    /\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?(\s+FINAL\b)?/gi
  )) {
    if (cteNames.has(match[2])) continue; // a CTE reference, not a real table -- already deduped inside its own definition
    const table = match[4] ? `${match[2]}.${match[4]}` : match[2];
    const normalized = normalizeTableName(table);
    const hasFinal = Boolean(match[5]);
    if (!hasFinal && isReplacingMergeTree(normalized)) {
      missing.add(normalized);
    }
  }
  return [...missing];
}
