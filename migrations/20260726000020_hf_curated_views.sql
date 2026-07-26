-- +goose Up

-- Latest snapshot per (scan_kind, model_id) — dedups the ReplacingMergeTree
-- so application queries always get the current state without FINAL.
CREATE VIEW IF NOT EXISTS curated.hf_model_latest AS
SELECT
    scan_kind,
    model_id,
    argMax(author, ingested_at) AS author,
    argMax(pipeline_tag, ingested_at) AS pipeline_tag,
    argMax(library_name, ingested_at) AS library_name,
    argMax(tags, ingested_at) AS tags,
    argMax(downloads, ingested_at) AS downloads,
    argMax(likes, ingested_at) AS likes,
    argMax(created_at, ingested_at) AS created_at,
    argMax(last_modified, ingested_at) AS last_modified,
    argMax(is_private, ingested_at) AS is_private,
    argMax(is_gated, ingested_at) AS is_gated,
    max(ingested_at) AS ingested_at,
    max(scan_at) AS scan_at
FROM raw.hf_model_snapshots
GROUP BY scan_kind, model_id;

-- Global dedup across all scan_kinds — single row per model_id
-- All mutable columns use argMax(ingested_at) to reflect the latest scan.
CREATE VIEW IF NOT EXISTS curated.hf_model_global_latest AS
SELECT
    model_id,
    argMax(author, ingested_at) AS author,
    argMax(pipeline_tag, ingested_at) AS pipeline_tag,
    argMax(library_name, ingested_at) AS library_name,
    argMax(tags, ingested_at) AS tags,
    argMax(downloads, ingested_at) AS downloads,
    argMax(likes, ingested_at) AS likes,
    argMax(created_at, ingested_at) AS created_at,
    argMax(last_modified, ingested_at) AS last_modified,
    argMax(is_private, ingested_at) AS is_private,
    argMax(is_gated, ingested_at) AS is_gated,
    max(ingested_at) AS ingested_at,
    max(scan_at) AS scan_at
FROM curated.hf_model_latest
GROUP BY model_id;

-- Per scan_kind summary for the breakdown chart
CREATE VIEW IF NOT EXISTS curated.hf_scan_kind_summary AS
SELECT
    scan_kind,
    count() AS model_count,
    sum(downloads) AS total_downloads,
    sum(likes) AS total_likes,
    countIf(is_gated = 1) AS gated_count,
    countIf(is_private = 1) AS private_count,
    max(scan_at) AS last_scan_at
FROM curated.hf_model_latest
GROUP BY scan_kind;

-- Per author summary for the author leaderboard (skips empty author)
CREATE VIEW IF NOT EXISTS curated.hf_author_summary AS
SELECT
    author,
    count() AS model_count,
    sum(downloads) AS total_downloads,
    sum(likes) AS total_likes,
    max(scan_at) AS last_scan_at
FROM curated.hf_model_global_latest
WHERE author != ''
GROUP BY author;

-- +goose Down
DROP VIEW IF EXISTS curated.hf_author_summary;
DROP VIEW IF EXISTS curated.hf_scan_kind_summary;
DROP VIEW IF EXISTS curated.hf_model_global_latest;
DROP VIEW IF EXISTS curated.hf_model_latest;
