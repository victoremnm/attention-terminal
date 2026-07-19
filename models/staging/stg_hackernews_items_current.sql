{{ config(materialized='view') }}

select
  hn_item_id,
  argMax(hn_item_type, updated_at) as hn_item_type,
  argMax(author, updated_at) as author,
  argMax(created_at, updated_at) as created_at,
  max(updated_at) as updated_at,
  toDate(argMax(created_at, updated_at)) as activity_date,
  argMax(title, updated_at) as title,
  argMax(text, updated_at) as text,
  argMax(url, updated_at) as url,
  argMax(parent, updated_at) as parent,
  argMax(score, updated_at) as score,
  argMax(comment_count, updated_at) as comment_count,
  argMax(is_deleted, updated_at) as is_deleted,
  argMax(is_dead, updated_at) as is_dead,
  argMax(is_removed, updated_at) as is_removed
from {{ ref('stg_hackernews_items') }}
group by hn_item_id
