{{ config(materialized='view') }}

select
  scan_date as activity_date,
  'huggingface' as source_id,
  cityHash64(model_id) as model_key,
  model_id,
  scan_kind as event_family,
  max(downloads) as downloads,
  max(likes) as likes,
  max(scan_at) as last_scan_at
from {{ ref('stg_huggingface_model_snapshots') }}
where model_id != ''
group by
  activity_date,
  source_id,
  model_key,
  model_id,
  event_family
