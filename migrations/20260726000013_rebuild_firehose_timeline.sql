-- +goose Up

-- The firehose schema was corrected after the original timeline MV was
-- deployed.  CREATE ... IF NOT EXISTS did not replace that old MV, which
-- continued to emit `0 commits to ...` from the removed `payload.size` field.
-- Rebuild the retained timeline from the payload-backed firehose and install
-- the current projection for subsequent inserts.
DROP VIEW IF EXISTS curated.event_timeline_mv;
TRUNCATE TABLE curated.event_timeline;

INSERT INTO curated.event_timeline
SELECT
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
FROM default.github_events_firehose
WHERE created_at >= now() - INTERVAL 7 DAY;

CREATE MATERIALIZED VIEW curated.event_timeline_mv TO curated.event_timeline AS
SELECT
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
DROP VIEW IF EXISTS curated.event_timeline_mv;
