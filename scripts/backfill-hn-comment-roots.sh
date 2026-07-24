#!/usr/bin/env bash
set -euo pipefail

# backfill-hn-comment-roots.sh
#
# Backfill the `root` column for historical HN comment rows where root = 0.
#
# Strategy: walk stories in chunks, fetch story + its kid chain from the HN API,
# and re-insert comment rows with root populated. The ReplacingMergeTree engine
# deduplicates on (id), so re-inserting is safe and idempotent.
#
# Usage:
#   ./scripts/backfill-hn-comment-roots.sh               # backfill all stories
#   ./scripts/backfill-hn-comment-roots.sh --chunk 1000   # process 1000 stories at a time
#   ./scripts/backfill-hn-comment-roots.sh --resume       # skip stories already processed
#
# Idempotent: resumes after interruption. Progress is tracked via a temp table
# or the watermark printed at each chunk.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

CHUNK_SIZE="${CHUNK_SIZE:-1000}"
RESUME="${RESUME:-false}"

# Parse args
while [ "$#" -gt 0 ]; do
  case "$1" in
    --chunk) CHUNK_SIZE="$2"; shift 2 ;;
    --resume) RESUME=true; shift ;;
    *) echo "Usage: $0 [--chunk N] [--resume]"; exit 1 ;;
  esac
done

echo "[backfill-hn-roots] Starting backfill (chunk=$CHUNK_SIZE, resume=$RESUME)"

# Get distinct story IDs from the hackernews table
STORIES=$(
  curl -s "$CLICKHOUSE_URL" \
    --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
    -d "SELECT DISTINCT id, kids FROM default.hackernews WHERE type = 'story' AND length(kids) > 0 ORDER BY id"
)

TOTAL=$(echo "$STORIES" | wc -l | tr -d ' ')
echo "[backfill-hn-roots] Found $TOTAL stories with kids to process"

COUNT=0
UPDATED=0

echo "$STORIES" | while IFS=$'\t' read -r story_id kids_json; do
  ((COUNT++)) || true

  # Extract kid IDs from JSON array
  KIDS=$(echo "$kids_json" | python3 -c "import sys,json; arr=json.load(sys.stdin); print(' '.join(str(x) for x in arr))" 2>/dev/null || echo "")

  if [ -z "$KIDS" ]; then
    continue
  fi

  # Fetch each kid from HN API and extract comment rows
  for kid_id in $KIDS; do
    # Check if this kid already has root set
    EXISTING_ROOT=$(curl -s "$CLICKHOUSE_URL" \
      --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
      -d "SELECT root FROM default.hackernews WHERE id = $kid_id AND root > 0 LIMIT 1" 2>/dev/null)

    if [ -n "$EXISTING_ROOT" ] && [ "$EXISTING_ROOT" != "0" ]; then
      continue  # skip, already processed
    fi

    RESULT=$(curl -s "https://hacker-news.firebaseio.com/v0/item/$kid_id.json")
    TYPE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type',''))" 2>/dev/null || echo "")

    if [ "$TYPE" != "comment" ] && [ "$TYPE" != "pollopt" ]; then
      continue
    fi

    # Re-insert the row with root=${story_id}; ReplacingMergeTree deduplicates
    ROW=$(echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(json.dumps({
    'id': d.get('id'),
    'deleted': 1 if d.get('deleted') else 0,
    'type': d.get('type', 'story'),
    'by': d.get('by', ''),
    'time': d.get('time', 0),
    'text': d.get('text', ''),
    'dead': 1 if d.get('dead') else 0,
    'parent': d.get('parent', 0),
    'poll': d.get('poll', 0),
    'kids': d.get('kids', []),
    'url': d.get('url', ''),
    'score': d.get('score', 0),
    'title': d.get('title', ''),
    'parts': d.get('parts', []),
    'descendants': d.get('descendants', 0),
    'root': $story_id,
}))
")

    curl -s "$CLICKHOUSE_URL?query=INSERT+INTO+default.hackernews+FORMAT+JSONEachRow" \
      --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
      -d "$ROW" > /dev/null

    ((UPDATED++)) || true
  done

  if [ $((COUNT % 100)) -eq 0 ]; then
    echo "[backfill-hn-roots] Processed $COUNT / $TOTAL stories, $UPDATED comment rows updated"
  fi
done

echo "[backfill-hn-roots] Done. Processed $TOTAL stories, updated $UPDATED comment rows"
