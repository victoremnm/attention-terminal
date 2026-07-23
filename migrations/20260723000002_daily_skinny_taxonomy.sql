-- +goose Up
-- Data-driven taxonomy for Daily Skinny subject matching. This replaces the hardcoded
-- topics in daily_skinny_subject_hourly's materialized views. Entries map HN and GitHub
-- matching patterns to normalized display names, making the taxonomy maintainable via data
-- instead of SQL conditionals. Note: does NOT include self-referential entries (this project).
--
-- `rank` orders entries by real-world popularity, not alphabetically. The language rows
-- (rank 1-19) are seeded from the githut dataset (github.com/blackfist/githut -- aggregated
-- GH Archive star/PR/push/issue event counts by language, 2012-2026), summed across all
-- four event types and all years/quarters, then sorted descending. The remaining rows
-- (rank 20+) are the previously-curated product/framework topics, unchanged, ordered after
-- the languages. `C` and `R` are intentionally excluded from hn_tokens matching despite
-- their real popularity: hasToken() matches whole tokens, and a bare single-letter token
-- ('c', 'r') false-positives on nearly any HN title -- there is no safe token for them in
-- this matching scheme, so they're omitted rather than shipped broken.
--
-- KNOWN LIMITATION (tracked, not fixed here): the daily_skinny_subject_hourly materialized
-- views (20260718000007_daily_skinny_subject_hourly.sql) still hardcode their own matching
-- via independent multiIf() chains that do NOT read from this table -- seeding real language
-- data here does not yet change what those MVs bucket, only what digest.ts's getTaxonomy()/
-- debateTakes() consumers see (topic list, search URLs, live HN "takes" lookup). Rewiring
-- the MVs to read this table dynamically is the deferred phase-2 noted in issue #127.
CREATE TABLE IF NOT EXISTS daily_skinny_taxonomy
(
    key String,
    display_name String,
    hn_tokens Array(String),          -- Tokens to match in HN story titles/text
    gh_repo_patterns Array(String),   -- LIKE patterns to match against gh_repo_name
    rank UInt32                       -- Display order, ascending = more popular. Not alphabetical.
)
ENGINE = ReplacingMergeTree
ORDER BY key;

-- Seed: top languages by real GH Archive activity (githut dataset), then curated
-- product/framework topics (excluding self-referential "Attention Terminal").
INSERT INTO daily_skinny_taxonomy VALUES
('javascript', 'JavaScript', ['javascript', 'js'], ['%javascript%'], 1),
('python', 'Python', ['python'], ['%python%'], 2),
('java', 'Java', ['java'], ['%java%'], 3),
('cpp', 'C++', ['c++', 'cpp'], ['%c++%', '%cpp%'], 4),
('php', 'PHP', ['php'], ['%php%'], 5),
('golang', 'Go', ['golang'], ['%golang%'], 6),
('ruby', 'Ruby', ['ruby'], ['%ruby%'], 7),
('html', 'HTML', ['html'], ['%html%'], 8),
('typescript', 'TypeScript', ['typescript'], ['%typescript%'], 9),
('csharp', 'C#', ['csharp', 'dotnet'], ['%csharp%', '%dotnet%'], 10),
('shell', 'Shell', ['bash'], ['%shell%', '%bash%'], 11),
('css', 'CSS', ['css'], ['%css%'], 12),
('objectivec', 'Objective-C', ['objective-c', 'objc'], ['%objective-c%', '%objc%'], 13),
('swift', 'Swift', ['swift'], ['%swift%'], 14),
('scala', 'Scala', ['scala'], ['%scala%'], 15),
('rust', 'Rust', ['rust'], ['%rust-lang%', '%rust%'], 16),
('jupyter', 'Jupyter Notebook', ['jupyter'], ['%jupyter%'], 17),
('kotlin', 'Kotlin', ['kotlin'], ['%kotlin%'], 18),
('coffeescript', 'CoffeeScript', ['coffeescript'], ['%coffeescript%'], 19),
('postgres', 'Postgres 18', ['postgres', 'postgresql', 'pg'], ['%postgres%', '%postgresql%'], 20),
('sqlite', 'SQLite', ['sqlite'], ['%sqlite%'], 21),
('clickhouse', 'ClickHouse', ['clickhouse'], ['%clickhouse%'], 22),
('bun', 'Bun', ['bun', 'oven'], ['%oven-sh/bun%', '%bun%'], 23),
('deno', 'Deno', ['deno'], ['%denoland/deno%', '%deno%'], 24),
('react', 'React', ['react'], ['%facebook/react%', '%react%'], 25),
('nextjs', 'Next.js', ['nextjs', 'next'], ['%vercel/next.js%', '%next.js%'], 26),
('tailwind', 'Tailwind CSS', ['tailwind'], ['%tailwindlabs/tailwindcss%', '%tailwind%'], 27),
('llama', 'Llama', ['llama'], ['%llama%'], 28),
('qwen', 'Qwen', ['qwen'], ['%qwen%'], 29),
('graphify', 'Graphify', ['graphify'], ['%graphify-labs/graphify%', '%graphify%'], 30);

-- +goose Down
DROP TABLE IF EXISTS daily_skinny_taxonomy;
