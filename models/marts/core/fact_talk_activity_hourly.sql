{{ config(materialized='view') }}

select
  hour as activity_hour,
  toDate(hour) as activity_date,
  'hackernews' as source_id,
  type as event_family,
  countMerge(items) as item_count,
  uniqMerge(authors) as actor_count,
  sum(score) as attention_score
from {{ source('raw', 'hn_hourly') }}
group by
  activity_hour,
  activity_date,
  source_id,
  event_family
