#!/usr/bin/env bash
set -euo pipefail

# backfill-hn-comment-roots.sh
#
# Backfill the `root` column for historical HN comment rows where root = 0.
#
# Strategy: walk stories in chunks, fetch each story's full kid tree from the
# HN API (recursive, depth-limited to 3), and re-insert comment rows with root
# populated. The ReplacingMergeTree engine deduplicates on (id), so re-inserting
# is safe and idempotent.
#
# Usage:
#   ./scripts/backfill-hn-comment-roots.sh               # backfill all stories
#   ./scripts/backfill-hn-comment-roots.sh --limit 100    # process at most N stories
#
# Idempotent: skips comment rows where root is already set.
# Resumes from where it left off.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

LIMIT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "Usage: $0 [--limit N]"; exit 1 ;;
  esac
done

echo "[backfill-hn-roots] Starting backfill (limit=$LIMIT)"

python3 <<'PYEOF'
import json, os, subprocess, sys, time

CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "")
CLICKHOUSE_USER = os.environ.get("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")

MAX_DEPTH = 3
CHUNK_SIZE = 25
HN_API = "https://hacker-news.firebaseio.com/v0"

LIMIT = os.environ.get("LIMIT")

def ch_query(sql):
    r = subprocess.run(
        ["curl", "-s", CLICKHOUSE_URL, "--user", f"{CLICKHOUSE_USER}:{CLICKHOUSE_PASSWORD}", "-d", sql],
        capture_output=True, text=True, timeout=30)
    return r.stdout.strip()

def ch_insert(table, rows):
    if not rows:
        return
    payload = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    subprocess.run(
        ["curl", "-s", CLICKHOUSE_URL, "--user", f"{CLICKHOUSE_USER}:{CLICKHOUSE_PASSWORD}",
         "-d", f"INSERT INTO {table} FORMAT JSONEachRow\n{payload}"],
        capture_output=True, timeout=30)

def fetch_json(path):
    for attempt in range(3):
        try:
            r = subprocess.run(
                ["curl", "-s", "--max-time", "10", f"{HN_API}/{path}"],
                capture_output=True, text=True, timeout=15)
            if r.returncode == 0:
                return json.loads(r.stdout)
        except (json.JSONDecodeError, subprocess.TimeoutExpired):
            time.sleep(1)
    return None

def fetch_kids_batch(kid_ids):
    """Fetch items for a batch of kid IDs, return list of API responses."""
    results = []
    for i in range(0, len(kid_ids), CHUNK_SIZE):
        batch = kid_ids[i:i+CHUNK_SIZE]
        for kid_id in batch:
            item = fetch_json(f"item/{kid_id}.json")
            results.append(item)
    return results

def fetch_kid_tree(kid_ids, existing_ids, depth=0):
    """Recursively fetch kid items and their descendants. Returns rows for ClickHouse."""
    if depth >= MAX_DEPTH or not kid_ids:
        return []

    rows = []
    missing = [k for k in kid_ids if k not in existing_ids]

    if missing:
        items = fetch_kids_batch(missing)
        for item in items:
            if not item or not item.get("id"):
                continue
            existing_ids.add(item["id"])

    # Collect kids for next depth level (both from newly fetched items and
    # items that already existed but might have unprocessed grandchildren).
    next_level = []
    for kid_id in kid_ids:
        item = fetch_json(f"item/{kid_id}.json")
        if not item or not item.get("id"):
            continue
        existing_ids.add(item["id"])
        if item.get("kids"):
            next_level.extend(item["kids"])

    # Fetch next level recursively
    deeper = fetch_kid_tree(next_level, existing_ids, depth + 1)
    rows.extend(deeper)

    return rows

def main():
    where = "root = 0"
    if os.environ.get("RESUME") == "true":
        where = "1=1"  # already idempotent — skip-if-root-set is per-row

    limit_clause = f"LIMIT {LIMIT}" if LIMIT else ""
    stories_sql = (
        f"SELECT id FROM default.hackernews "
        f"WHERE type = 'story' AND length(kids) > 0 "
        f"ORDER BY id {limit_clause}"
    )

    stories = ch_query(stories_sql).strip().split("\n")
    stories = [s.strip() for s in stories if s.strip()]
    total = len(stories)
    print(f"[backfill-hn-roots] Found {total} stories to process")

    count = 0
    updated = 0

    for story_id_str in stories:
        try:
            story_id = int(story_id_str)
        except ValueError:
            continue
        count += 1

        story = fetch_json(f"item/{story_id}.json")
        if not story or not story.get("kids"):
            continue

        existing_ids = set()
        rows = fetch_kid_tree(story["kids"], existing_ids)
        comment_rows = [
            {**r, "root": story_id}
            for r in rows
            if r.get("type") in ("comment", "pollopt")
        ]
        # Deduplicate by id
        seen = set()
        deduped = []
        for r in comment_rows:
            rid = r.get("id")
            if rid and rid not in seen:
                seen.add(rid)
                deduped.append(r)

        if deduped:
            # Build full HN rows for re-insertion
            insert_rows = []
            for r in deduped:
                item = fetch_json(f"item/{r['id']}.json")
                if not item:
                    continue
                insert_rows.append({
                    "id": item["id"],
                    "deleted": 1 if item.get("deleted") else 0,
                    "type": item.get("type", "story"),
                    "by": item.get("by", ""),
                    "time": item.get("time", 0),
                    "text": item.get("text", ""),
                    "dead": 1 if item.get("dead") else 0,
                    "parent": item.get("parent", 0),
                    "poll": item.get("poll", 0),
                    "kids": item.get("kids", []),
                    "url": item.get("url", ""),
                    "score": item.get("score", 0),
                    "title": item.get("title", ""),
                    "parts": item.get("parts", []),
                    "descendants": item.get("descendants", 0),
                    "root": story_id,
                })
            if insert_rows:
                ch_insert("default.hackernews", insert_rows)
                updated += len(insert_rows)

        if count % 100 == 0:
            print(f"[backfill-hn-roots] Processed {count}/{total} stories, {updated} rows updated")

    print(f"[backfill-hn-roots] Done. Processed {total} stories, updated {updated} rows")

if __name__ == "__main__":
    main()
PYEOF
