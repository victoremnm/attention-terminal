{{ config(materialized='view') }}

select
  month as activity_month,
  'github' as source_id,
  cityHash64(repo_name) as repo_key,
  repo_name,
  countMerge(events) as event_count,
  uniqMerge(actors) as actor_count,
  sum(pushes) as pushes,
  sum(commits) as commits,
  sum(distinct_commits) as distinct_commits,
  sum(stars) as stars,
  sum(forks) as forks,
  sum(prs_opened) as prs_opened,
  sum(prs_closed) as prs_closed,
  sum(prs_merged) as prs_merged,
  sum(issues_opened) as issues_opened,
  sum(issues_closed) as issues_closed,
  sum(repos_created) as repos_created,
  sum(branches_created) as branches_created,
  sum(tags_created) as tags_created,
  sum(releases_published) as releases_published
from {{ source('raw', 'gh_repo_monthly') }}
group by
  activity_month,
  source_id,
  repo_key,
  repo_name
