-- +goose Up

-- Migration 13 rebuilt curated.event_timeline, but its replacement MV kept
-- targeting the temporary table that migration 13 dropped. Recreate the live
-- projection against the exchanged table so new firehose inserts are routed
-- into the production timeline again.
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
-- Keep the repaired projection active when this migration is rolled back in
-- isolation; restoring migration 12 would reintroduce stale payload logic.
SELECT 1;
