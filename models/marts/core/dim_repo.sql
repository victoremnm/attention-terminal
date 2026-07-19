{{ config(materialized='table', engine='MergeTree()', order_by='(repo_owner, repo_name)') }}

select
  cityHash64(repo_name) as repo_key,
  repo_name,
  repo_owner,
  repo_short_name,
  min(created_at) as first_seen_at,
  max(created_at) as last_seen_at
from {{ ref('stg_github_events') }}
where repo_name != ''
group by
  repo_name,
  repo_owner,
  repo_short_name
