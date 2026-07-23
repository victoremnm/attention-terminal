-- +goose Up
-- Add title and labels columns to capture PR/Issue activity flavor
-- These fields are populated for PullRequestEvent and IssuesEvent, nullable for others
ALTER TABLE github_events
  ADD COLUMN IF NOT EXISTS title Nullable(String) AFTER number,
  ADD COLUMN IF NOT EXISTS labels Array(String) DEFAULT [] AFTER title;

-- +goose Down
ALTER TABLE github_events
  DROP COLUMN IF EXISTS labels,
  DROP COLUMN IF EXISTS title;
