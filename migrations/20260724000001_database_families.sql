-- +goose Up
CREATE DATABASE IF NOT EXISTS raw;

-- Views wrapping existing default.* tables so code can query raw.*
-- without moving tables or recreating MVs. MVs in default continue
-- reading from default.github_events et al. INSERTs into raw.* views
-- are forwarded to the underlying default.* tables automatically.

CREATE VIEW IF NOT EXISTS raw.github_events AS SELECT * FROM default.github_events;
CREATE VIEW IF NOT EXISTS raw.hackernews AS SELECT * FROM default.hackernews;
CREATE VIEW IF NOT EXISTS raw.hf_model_snapshots AS SELECT * FROM default.hf_model_snapshots;

-- +goose Down
DROP VIEW IF EXISTS raw.github_events;
DROP VIEW IF EXISTS raw.hackernews;
DROP VIEW IF EXISTS raw.hf_model_snapshots;
DROP DATABASE IF EXISTS raw;
