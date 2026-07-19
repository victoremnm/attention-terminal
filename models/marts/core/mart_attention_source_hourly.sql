{{ config(materialized='view') }}

select
  activity_hour,
  activity_date,
  source_id,
  '' as entity_id,
  event_family,
  item_count as activity_count,
  actor_count,
  toInt64(attention_score) as attention_score
from {{ ref('fact_talk_activity_hourly') }}

union all

select
  activity_hour,
  activity_date,
  source_id,
  repo_name as entity_id,
  event_family,
  event_count as activity_count,
  actor_count,
  toInt64(event_count) as attention_score
from {{ ref('fact_code_activity_hourly') }}
