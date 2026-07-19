{{ config(materialized='table', engine='ReplacingMergeTree(last_seen_at)', order_by='(model_owner, model_id)') }}

select
  cityHash64(model_id) as model_key,
  model_id,
  model_owner,
  model_name,
  argMax(author, scan_at) as author,
  argMax(pipeline_tag, scan_at) as pipeline_tag,
  argMax(library_name, scan_at) as library_name,
  argMax(tags, scan_at) as tags,
  min(created_at) as created_at,
  max(last_modified) as last_modified,
  max(scan_at) as last_seen_at
from {{ ref('stg_huggingface_model_snapshots') }}
where model_id != ''
group by
  model_id,
  model_owner,
  model_name
