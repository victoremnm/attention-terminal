-- +goose Up
ALTER TABLE github_events
  ADD COLUMN IF NOT EXISTS ref_type LowCardinality(String) DEFAULT '' AFTER action;

-- +goose Down
ALTER TABLE github_events
  DROP COLUMN IF EXISTS ref_type;
