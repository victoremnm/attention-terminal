-- +goose Up

-- Some production clusters retained the pre-rebuild timeline schema even
-- though migration 13 was marked applied. Add the identity column before
-- recreating the MV so the repaired projection cannot silently discard it.
ALTER TABLE curated.event_timeline
    ADD COLUMN IF NOT EXISTS event_id UInt64 DEFAULT 0 AFTER created_at;

DROP VIEW IF EXISTS curated.event_timeline_mv;

CREATE MATERIALIZED VIEW curated.event_timeline_mv
TO curated.event_timeline AS
SELECT
    event_id,
    created_at,
    repo_name,
    actor_login,
    actor_avatar,
    event_type,
    action,
    title,
    number,
    if(event_type = 'PushEvent',
       if(JSONExtractString(payload, 'ref') != '',
          concat('pushed to ', replaceRegexpOne(JSONExtractString(payload, 'ref'), '^refs/heads/', '')),
          'pushed'),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(number)),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(number)),
                   if(event_type = 'CreateEvent',
                      if(ref_type != '', concat('created ', ref_type), 'created'),
                      if(event_type = 'DeleteEvent',
                         if(ref_type != '', concat('deleted ', ref_type), 'deleted'),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', coalesce(title, '')),
                            event_type)))))))) AS payload_summary
FROM default.github_events_firehose;

-- +goose Down
-- Preserve the repaired identity column and MV if this migration is rolled
-- back in isolation; dropping event_id would recreate github:0 identities.
SELECT 1;
