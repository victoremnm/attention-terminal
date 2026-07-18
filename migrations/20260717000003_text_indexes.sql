-- +goose Up
-- Token bloom-filter skip indexes so arbitrary-keyword trend scans over ~49M
-- HN items stay sub-second (hasToken(lower(title), 'rust') etc.).
ALTER TABLE hackernews ADD INDEX IF NOT EXISTS idx_title_tokens lower(title) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
ALTER TABLE hackernews ADD INDEX IF NOT EXISTS idx_text_tokens lower(text) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
ALTER TABLE hackernews MATERIALIZE INDEX idx_title_tokens;
ALTER TABLE hackernews MATERIALIZE INDEX idx_text_tokens;

-- +goose Down
ALTER TABLE hackernews DROP INDEX IF EXISTS idx_title_tokens;
ALTER TABLE hackernews DROP INDEX IF EXISTS idx_text_tokens;
