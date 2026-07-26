import { q } from "./core";
import type { QueryResult } from "./types";

const HF_MODEL_LATEST_TABLES = ["curated.hf_model_latest"];
const HF_MODEL_GLOBAL_TABLES = ["curated.hf_model_global_latest"];
const HF_SCAN_KIND_TABLES = ["curated.hf_scan_kind_summary"];
const HF_AUTHOR_TABLES = ["curated.hf_author_summary"];
const HF_RAW_TABLES = ["raw.hf_model_snapshots"];

export interface HfHeadlineRow {
  total_models: string;
  total_downloads: string;
  total_likes: string;
  scan_kinds_covered: string;
  last_scan_at: string;
}

export interface HfTopModelRow {
  model_id: string;
  author: string;
  pipeline_tag: string;
  library_name: string;
  downloads: string;
  likes: string;
  is_gated: string;
  is_private: string;
  created_at?: string;
  tags?: string[];
}

export type HfModelDetail = HfTopModelRow & { scan_history: HfScanHistoryRow[] };

export interface HfTrendingModelRow {
  model_id: string;
  author: string;
  pipeline_tag: string;
  created_at: string;
  scan_at: string;
}

export interface HfAuthorRow {
  author: string;
  model_count: string;
  total_downloads: string;
  total_likes: string;
}

export interface HfPipelineTagRow {
  pipeline_tag: string;
  model_count: string;
  total_downloads: string;
}

export interface HfLibraryRow {
  library_name: string;
  model_count: string;
  total_downloads: string;
}

export interface HfScanKindRow {
  scan_kind: string;
  model_count: string;
  total_downloads: string;
  total_likes: string;
  last_scan_at: string;
}

export interface HfTagRow {
  tag: string;
  model_count: string;
}

export interface HfScanHistoryRow {
  scan_at: string;
  scan_kind: string;
  downloads: string;
  likes: string;
}

const SORT_OPTIONS = new Set(["downloads", "likes", "created_at"]);

async function safeQ<T>(
  sql: string,
  tables: string[],
  query_params?: Record<string, unknown>
): Promise<{ rows: T[]; sql: string; elapsedMs: number }> {
  try {
    const { rows, provenance } = await q<T>(sql, tables, query_params);
    return { rows, sql: provenance.sql, elapsedMs: provenance.elapsedMs };
  } catch {
    return { rows: [], sql: sql.trim(), elapsedMs: 0 };
  }
}

export async function hfModelsHeadline(): Promise<QueryResult<HfHeadlineRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfHeadlineRow>(
    `SELECT
       toString(count()) AS total_models,
       toString(sum(downloads)) AS total_downloads,
       toString(sum(likes)) AS total_likes,
       (SELECT toString(count()) FROM curated.hf_scan_kind_summary) AS scan_kinds_covered,
       toString(max(last_scan_at)) AS last_scan_at
     FROM curated.hf_model_global_latest`,
    HF_MODEL_GLOBAL_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfTopModels(
  sort: "downloads" | "likes" | "created_at" = "downloads",
  limit = 50
): Promise<QueryResult<HfTopModelRow[]>> {
  const orderCol = SORT_OPTIONS.has(sort) ? sort : "downloads";
  const { rows, sql, elapsedMs } = await safeQ<HfTopModelRow>(
    `SELECT
       model_id,
       author,
       pipeline_tag,
       library_name,
       toString(downloads) AS downloads,
       toString(likes) AS likes,
       toString(is_gated) AS is_gated,
       toString(is_private) AS is_private,
       toString(created_at) AS created_at
     FROM curated.hf_model_global_latest
     ORDER BY ${orderCol} DESC
     LIMIT {limit: UInt32}`,
    HF_MODEL_GLOBAL_TABLES,
    { limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfTrendingModels(
  limit = 20
): Promise<QueryResult<HfTrendingModelRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfTrendingModelRow>(
    `SELECT
       model_id,
       author,
       pipeline_tag,
       toString(created_at) AS created_at,
       toString(last_scan_at) AS scan_at
     FROM curated.hf_model_global_latest
     WHERE created_at > toDateTime(now() - 86400 * 7)
     ORDER BY created_at DESC
     LIMIT {limit: UInt32}`,
    HF_MODEL_GLOBAL_TABLES,
    { limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfAuthorLeaderboard(
  limit = 15
): Promise<QueryResult<HfAuthorRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfAuthorRow>(
    `SELECT
       author,
       toString(model_count) AS model_count,
       toString(total_downloads) AS total_downloads,
       toString(total_likes) AS total_likes
     FROM curated.hf_author_summary
     ORDER BY total_downloads DESC
     LIMIT {limit: UInt32}`,
    HF_AUTHOR_TABLES,
    { limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfPipelineTagDistribution(): Promise<QueryResult<HfPipelineTagRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfPipelineTagRow>(
    `SELECT
       pipeline_tag,
       toString(count()) AS model_count,
       toString(sum(downloads)) AS total_downloads
     FROM curated.hf_model_global_latest
     WHERE pipeline_tag != ''
     GROUP BY pipeline_tag
     ORDER BY count() DESC
     LIMIT 12`,
    HF_MODEL_GLOBAL_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfLibraryDistribution(): Promise<QueryResult<HfLibraryRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfLibraryRow>(
    `SELECT
       multiIf(library_name = '', 'unknown', library_name) AS library_name,
       toString(count()) AS model_count,
       toString(sum(downloads)) AS total_downloads
     FROM curated.hf_model_global_latest
     GROUP BY library_name
     ORDER BY count() DESC
     LIMIT 10`,
    HF_MODEL_GLOBAL_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfScanKindBreakdown(): Promise<QueryResult<HfScanKindRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfScanKindRow>(
    `SELECT
       scan_kind,
       toString(model_count) AS model_count,
       toString(total_downloads) AS total_downloads,
       toString(total_likes) AS total_likes,
       toString(last_scan_at) AS last_scan_at
     FROM curated.hf_scan_kind_summary
     ORDER BY total_downloads DESC`,
    HF_SCAN_KIND_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfTagFrequency(
  limit = 15
): Promise<QueryResult<HfTagRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<HfTagRow>(
    `SELECT
       arrayJoin(tags) AS tag,
       toString(count()) AS model_count
     FROM curated.hf_model_global_latest
     WHERE arrayExists(x -> x != '', tags)
     GROUP BY tag
     ORDER BY count() DESC
     LIMIT {limit: UInt32}`,
    HF_MODEL_GLOBAL_TABLES,
    { limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function hfModelDetail(
  modelId: string
): Promise<QueryResult<HfTopModelRow & { scan_history: HfScanHistoryRow[] } | null>> {
  const { rows: meta, sql, elapsedMs } = await safeQ<HfTopModelRow>(
    `SELECT
       model_id,
       author,
       pipeline_tag,
       library_name,
       toString(downloads) AS downloads,
       toString(likes) AS likes,
       toString(is_gated) AS is_gated,
       toString(is_private) AS is_private,
       tags
     FROM curated.hf_model_global_latest
     WHERE model_id = {modelId: String}
     LIMIT 1`,
    HF_MODEL_GLOBAL_TABLES,
    { modelId }
  );

  if (meta.length === 0) {
    return { data: null, sql, rowsRead: 0, elapsedMs };
  }

  const { rows: history } = await safeQ<HfScanHistoryRow>(
    `SELECT
       toString(scan_at) AS scan_at,
       scan_kind,
       toString(argMax(downloads, ingested_at)) AS downloads,
       toString(argMax(likes, ingested_at)) AS likes
     FROM raw.hf_model_snapshots
     WHERE model_id = {modelId: String}
     GROUP BY scan_at, scan_kind
     ORDER BY scan_at DESC
     LIMIT 24`,
    HF_RAW_TABLES,
    { modelId }
  );

  return {
    data: { ...meta[0], scan_history: history },
    sql,
    rowsRead: 0,
    elapsedMs,
  };
}
