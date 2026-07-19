{{ config(materialized='view') }}

select
  hour as activity_hour,
  toDate(hour) as activity_date,
  'github' as source_id,
  cityHash64(repo_name) as repo_key,
  repo_name,
  event_type as event_family,
  countMerge(events) as event_count,
  uniqMerge(actors) as actor_count
from {{ source('raw', 'gh_repo_hourly') }}
group by
  activity_hour,
  activity_date,
  source_id,
  repo_key,
  repo_name,
  event_family
