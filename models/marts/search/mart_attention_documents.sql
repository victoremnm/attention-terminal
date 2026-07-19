{{ config(materialized='view') }}

select
  'hackernews' as source_id,
  toString(hn_item_id) as document_id,
  created_at as observed_at,
  title as title,
  text as body,
  url,
  concat(title, '\n\n', text) as embedding_text,
  score + comment_count as popularity_score
from {{ ref('stg_hackernews_items') }}
where hn_item_type = 'story'
  and is_removed = 0
  and length(title) > 0

union all

select
  'github' as source_id,
  repo_name as document_id,
  max(created_at) as observed_at,
  repo_name as title,
  concat('GitHub repository activity for ', repo_name) as body,
  concat('https://github.com/', repo_name) as url,
  concat(repo_name, '\n\n', arrayStringConcat(groupArrayDistinct(event_type), ', ')) as embedding_text,
  count() as popularity_score
from {{ ref('stg_github_events') }}
where repo_name != ''
group by repo_name

union all

select
  'huggingface' as source_id,
  model_id as document_id,
  max(scan_at) as observed_at,
  model_id as title,
  concat('Hugging Face model ', model_id, ' tagged ', arrayStringConcat(argMax(tags, scan_at), ', ')) as body,
  concat('https://huggingface.co/', model_id) as url,
  concat(model_id, '\n\n', arrayStringConcat(argMax(tags, scan_at), ', ')) as embedding_text,
  max(downloads) + max(likes) as popularity_score
from {{ ref('stg_huggingface_model_snapshots') }}
where model_id != ''
group by model_id
