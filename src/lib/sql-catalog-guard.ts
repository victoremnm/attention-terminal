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
  { database: "raw", name: "github_events", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_hourly", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_actor_daily", engine: "SummingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_activity_feed", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "gh_repo_analysis", engine: "ReplacingMergeTree", total_rows: "estimated", size: "N/A" },
  { database: "default", name: "subagent_runs", engine: "MergeTree", total_rows: "estimated", size: "N/A" },
];

export const TABLE_LIST_LIMIT = 50;

export const LIST_TABLES_SQL = `
  SELECT database, name, engine, total_rows, formatReadableSize(total_bytes) AS size
  FROM system.tables
  WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
  ORDER BY database, name
  LIMIT {limit: UInt32}
`.trim();

const knownTables = new Set<string>();
const knownSchemas = new Map<string, string[]>();
const knownEngines = new Map<string, string>();

export function resetCatalogState() {
  knownTables.clear();
  knownSchemas.clear();
  knownEngines.clear();
}

export function registerCatalogTables(tables: CatalogTableRef[]) {
  for (const table of tables) {
    knownTables.add(`${table.database}.${table.name}`);
    knownTables.add(table.name);
    if (table.engine) {
      knownEngines.set(`${table.database}.${table.name}`, table.engine);
      knownEngines.set(table.name, table.engine);
    }
  }
}

export function isReplacingMergeTree(name: string): boolean {
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

export function extractTableCandidates(query: string): string[] {
  const cteNames = new Set<string>();
  for (const match of query.matchAll(/\b([A-Za-z_][\w$]*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1]);
  }

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
 * this only fires on a confirmed ReplacingMergeTree.
 */
export function requireFinalOnReplacingTables(query: string): string[] {
  const missing = new Set<string>();
  for (const match of query.matchAll(
    /\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?(\s+FINAL\b)?/gi
  )) {
    const table = match[4] ? `${match[2]}.${match[4]}` : match[2];
    const normalized = normalizeTableName(table);
    const hasFinal = Boolean(match[5]);
    if (!hasFinal && isReplacingMergeTree(normalized)) {
      missing.add(normalized);
    }
  }
  return [...missing];
}
