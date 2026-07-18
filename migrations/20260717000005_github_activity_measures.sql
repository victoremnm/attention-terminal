-- +goose Up
ALTER TABLE github_events
  ADD COLUMN IF NOT EXISTS commit_count UInt16 DEFAULT 0 AFTER ref_type,
  ADD COLUMN IF NOT EXISTS distinct_commit_count UInt16 DEFAULT 0 AFTER commit_count,
  ADD COLUMN IF NOT EXISTS pr_merged UInt8 DEFAULT 0 AFTER distinct_commit_count;

-- +goose Down
ALTER TABLE github_events
  DROP COLUMN IF EXISTS pr_merged,
  DROP COLUMN IF EXISTS distinct_commit_count,
  DROP COLUMN IF EXISTS commit_count;
