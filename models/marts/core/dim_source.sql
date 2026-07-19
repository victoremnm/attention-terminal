{{ config(materialized='table', engine='MergeTree()', order_by='(source_id)') }}

select
  'hackernews' as source_id,
  'Hacker News' as source_name,
  'talk' as source_family
union all
select
  'github' as source_id,
  'GitHub Archive' as source_name,
  'code' as source_family
union all
select
  'huggingface' as source_id,
  'Hugging Face Hub' as source_name,
  'model' as source_family
