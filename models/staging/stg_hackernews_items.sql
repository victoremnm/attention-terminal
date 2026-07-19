{{ config(materialized='view') }}

select
  id as hn_item_id,
  type as hn_item_type,
  by as author,
  time as created_at,
  update_time as updated_at,
  toDate(time) as activity_date,
  title,
  text,
  url,
  parent,
  score,
  greatest(descendants, 0) as comment_count,
  deleted as is_deleted,
  dead as is_dead,
  if(deleted = 1 or dead = 1, 1, 0) as is_removed
from {{ source('raw', 'hackernews') }}
