-- +goose Up
-- ClickHouse requires hasToken's token argument to be a constant. The live
-- taxonomy-driven HN view previously passed the array lambda variable to
-- hasToken, which caused every Hacker News insert to fail while the view ran.
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_hn_hourly_mv TO daily_skinny_subject_hourly AS
SELECT
    hour,
    subject,
    'hn' AS source,
    count() AS talk_threads,
    sum(greatest(descendants, 0)) AS comments,
    0 AS code_score,
    0 AS gh_stars,
    uniqState('') AS repos
FROM
(
    SELECT
        toStartOfHour(h.time) AS hour,
        h.id,
        h.descendants,
        argMin(t.display_name, t.rank) AS subject
    FROM hackernews h
    CROSS JOIN daily_skinny_taxonomy t
    WHERE h.type = 'story'
      AND h.deleted = 0
      AND h.dead = 0
      AND arrayExists(tok -> position(lower(h.title), tok) > 0, t.hn_tokens)
    GROUP BY hour, h.id, h.descendants
)
GROUP BY hour, subject;

-- +goose Down
-- Keep the repaired view in place on rollback. Dropping it would remove the
-- pre-existing ingestion pipeline without restoring a usable definition.
