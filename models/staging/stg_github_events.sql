{{ config(materialized='view') }}

select
  event_id,
  event_type,
  actor_login,
  repo_name,
  splitByChar('/', repo_name)[1] as repo_owner,
  splitByChar('/', repo_name)[2] as repo_short_name,
  created_at,
  toDate(created_at) as activity_date,
  toStartOfHour(created_at) as activity_hour,
  action,
  ref_type,
  commit_count,
  distinct_commit_count,
  pr_merged,
  number
from {{ source('raw', 'github_events') }}
