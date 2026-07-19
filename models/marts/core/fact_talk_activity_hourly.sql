{{ config(materialized='view') }}

select
  toStartOfHour(created_at) as activity_hour,
  toDate(created_at) as activity_date,
  'hackernews' as source_id,
  hn_item_type as event_family,
  uniqExact(hn_item_id) as item_count,
  uniqExact(author) as actor_count,
  sum(comment_count) as comment_count,
  sum(score) as attention_score
from {{ ref('stg_hackernews_items_current') }}
group by
  activity_hour,
  activity_date,
  source_id,
  event_family
