-- +goose Up
-- Migration 20260726000006 replaced the invalid dynamic hasToken call with
-- substring position matching. Preserve the ClickHouse-compatible dynamic
-- predicate while restoring hasToken's whole-token semantics.
-- Historical rows are intentionally backfilled separately: the target is an
-- additive AggregatingMergeTree, so an in-migration INSERT would double-count
-- existing rows. Pause the HN writer during deployment, then run the bounded
-- taxonomy backfill in #271 with both writers paused.
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
    -- Intentional bounded dimension expansion: each story must be compared
    -- with each tokenized subject, and the taxonomy table is a small config
    -- dimension. Filter empty token sets before expanding the source rows.
    CROSS JOIN (
        SELECT display_name, rank, hn_tokens
        FROM daily_skinny_taxonomy
        WHERE length(hn_tokens) > 0
    ) t
    WHERE h.type = 'story'
      AND h.deleted = 0
      AND h.dead = 0
      AND arrayExists(
        tok -> position(
          concat(' ', replaceRegexpAll(lower(h.title), '[^a-z0-9]+', ' '), ' '),
          concat(' ', tok, ' ')
        ) > 0,
        t.hn_tokens
      )
    GROUP BY hour, h.id, h.descendants
)
GROUP BY hour, subject;

-- +goose Down
-- Keep the repaired view in place on rollback. Dropping it would remove the
-- ingestion pipeline without restoring a usable definition.
