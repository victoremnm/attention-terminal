-- +goose Up
-- 1. Create Read-Only Analyst Role for Data Policy Language Enforcers & Analysts
CREATE ROLE IF NOT EXISTS read_only_analyst_role;

-- 2. Grant SELECT access to ALL data taxonomy databases and standard system tables
GRANT SELECT ON curated.* TO read_only_analyst_role;
GRANT SELECT ON cleansed.* TO read_only_analyst_role;
GRANT SELECT ON default.* TO read_only_analyst_role;
GRANT SELECT ON raw.* TO read_only_analyst_role;
GRANT SELECT ON internal.* TO read_only_analyst_role;
GRANT SELECT ON system.tables TO read_only_analyst_role;
GRANT SELECT ON system.columns TO read_only_analyst_role;
GRANT SELECT ON system.databases TO read_only_analyst_role;

-- 3. Create dedicated read-only analyst user
CREATE USER IF NOT EXISTS read_only_analyst IDENTIFIED WITH plaintext_password BY 'ReadOnlyAnalyst2026!';
GRANT read_only_analyst_role TO read_only_analyst;

-- +goose Down
DROP USER IF EXISTS read_only_analyst;
DROP ROLE IF EXISTS read_only_analyst_role;
