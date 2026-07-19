{{ config(materialized='view') }}

select
  'day' as grain,
  activity_date as period_start,
  source_id,
  repo_key,
  repo_name,
  event_count,
  actor_count,
  pushes,
  commits,
  distinct_commits,
  stars,
  forks,
  prs_opened,
  prs_closed,
  prs_merged,
  issues_opened,
  issues_closed,
  repos_created,
  branches_created,
  tags_created,
  releases_published,
  commits + prs_opened * 3 + prs_merged * 5 + issues_opened * 2 + stars * 2 + forks * 2 as trend_score
from {{ ref('fact_repo_activity_daily') }}

union all

select
  'month' as grain,
  activity_month as period_start,
  source_id,
  repo_key,
  repo_name,
  event_count,
  actor_count,
  pushes,
  commits,
  distinct_commits,
  stars,
  forks,
  prs_opened,
  prs_closed,
  prs_merged,
  issues_opened,
  issues_closed,
  repos_created,
  branches_created,
  tags_created,
  releases_published,
  commits + prs_opened * 3 + prs_merged * 5 + issues_opened * 2 + stars * 2 + forks * 2 as trend_score
from {{ ref('fact_repo_activity_monthly') }}
