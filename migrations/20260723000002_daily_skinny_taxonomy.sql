-- +goose Up
-- Data-driven taxonomy for Daily Skinny subject matching. This replaces the hardcoded
-- topics in daily_skinny_subject_hourly's materialized views. Entries map HN and GitHub
-- matching patterns to normalized display names, making the taxonomy maintainable via data
-- instead of SQL conditionals. Note: does NOT include self-referential entries (this project).
CREATE TABLE IF NOT EXISTS daily_skinny_taxonomy
(
    key String,
    display_name String,
    hn_tokens Array(String),          -- Tokens to match in HN story titles/text
    gh_repo_patterns Array(String)    -- LIKE patterns to match against gh_repo_name
)
ENGINE = ReplacingMergeTree
ORDER BY key;

-- Seed with established topics (excluding self-referential "Attention Terminal")
INSERT INTO daily_skinny_taxonomy VALUES
('postgres', 'Postgres 18', ['postgres', 'postgresql', 'pg'], ['%postgres%', '%postgresql%']),
('sqlite', 'SQLite', ['sqlite'], ['%sqlite%']),
('clickhouse', 'ClickHouse', ['clickhouse'], ['%clickhouse%']),
('bun', 'Bun', ['bun', 'oven'], ['%oven-sh/bun%', '%bun%']),
('deno', 'Deno', ['deno'], ['%denoland/deno%', '%deno%']),
('rust', 'Rust', ['rust'], ['%rust-lang%', '%rust%']),
('react', 'React', ['react'], ['%facebook/react%', '%react%']),
('nextjs', 'Next.js', ['nextjs', 'next'], ['%vercel/next.js%', '%next.js%']),
('tailwind', 'Tailwind CSS', ['tailwind'], ['%tailwindlabs/tailwindcss%', '%tailwind%']),
('llama', 'Llama', ['llama'], ['%llama%']),
('qwen', 'Qwen', ['qwen'], ['%qwen%']),
('graphify', 'Graphify', ['graphify'], ['%graphify-labs/graphify%', '%graphify%']);

-- +goose Down
DROP TABLE IF EXISTS daily_skinny_taxonomy;
