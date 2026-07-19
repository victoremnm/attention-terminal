{{ config(materialized='view') }}

select
  scan_at,
  toDate(scan_at) as scan_date,
  scan_kind,
  model_id,
  author,
  splitByChar('/', model_id)[1] as model_owner,
  splitByChar('/', model_id)[2] as model_name,
  pipeline_tag,
  library_name,
  tags,
  downloads,
  likes,
  created_at,
  last_modified,
  is_private,
  is_gated,
  ingested_at
from {{ source('raw', 'hf_model_snapshots') }}
