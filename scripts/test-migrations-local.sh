#!/usr/bin/env bash
# Run the complete Goose migration chain against a disposable OSS ClickHouse.
# The source-schema fixture is applied through Goose because those legacy source
# tables pre-date this repository's migration history.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

IMAGE="${CLICKHOUSE_IMAGE:-clickhouse/clickhouse-server:26.2}"
PASSWORD="${CLICKHOUSE_LOCAL_PASSWORD:-local-migration-test}"
CONTAINER="${CLICKHOUSE_LOCAL_CONTAINER:-attention-terminal-migrations-${RANDOM}-${RANDOM}}"
KEEP_CONTAINER="${KEEP_CLICKHOUSE_CONTAINER:-0}"
RUN_MIGRATION_ROLLBACK="${RUN_MIGRATION_ROLLBACK:-0}"
TMP_DIR=""
PORT=""

cleanup() {
  if [[ "$KEEP_CONTAINER" == "1" ]]; then
    echo "Keeping ClickHouse container: ${CONTAINER}"
    return
  fi
  if [[ -n "$CONTAINER" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

die() {
  echo "local migration smoke test: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v goose >/dev/null 2>&1 || die "goose is required (see README development setup)"

echo "Starting disposable OSS ClickHouse (${IMAGE})"
docker run --detach --name "$CONTAINER" \
  --publish 127.0.0.1::9000 \
  --env CLICKHOUSE_USER=default \
  --env CLICKHOUSE_PASSWORD="$PASSWORD" \
  --env CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  "$IMAGE" >/dev/null

PORT="$(docker port "$CONTAINER" 9000/tcp | awk -F: 'NR == 1 { print $NF }')"
[[ -n "$PORT" ]] || die "could not determine the ClickHouse native port"

for attempt in $(seq 1 60); do
  if docker exec "$CONTAINER" clickhouse-client \
      --user default --password "$PASSWORD" --query 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    docker logs "$CONTAINER" >&2 || true
    die "ClickHouse did not become ready"
  fi
  sleep 1
done

export GOOSE_DRIVER=clickhouse
export GOOSE_DBSTRING="clickhouse://default:${PASSWORD}@127.0.0.1:${PORT}/default?secure=false"

echo "Validating checked-in migrations"
goose --no-color -dir migrations validate

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/attention-terminal-migrations.XXXXXX")"
cat >"$TMP_DIR/00000000000001_local_source_schema.sql" <<'SQL'
-- +goose Up
SQL
cat scripts/local-clickhouse-source-schema.sql >>"$TMP_DIR/00000000000001_local_source_schema.sql"
cat >>"$TMP_DIR/00000000000001_local_source_schema.sql" <<'SQL'

-- +goose Down
DROP TABLE IF EXISTS default.github_events;
DROP TABLE IF EXISTS default.hackernews;
SQL

echo "Applying legacy source-schema fixture through Goose"
goose --no-color --no-versioning -dir "$TMP_DIR" up

echo "Applying checked-in migrations"
if ! goose --no-color -dir migrations up; then
  echo >&2
  echo "Migration failed. The ClickHouse container is disposable; set KEEP_CLICKHOUSE_CONTAINER=1 to inspect it." >&2
  echo "Container: ${CONTAINER}" >&2
  echo "Native endpoint: 127.0.0.1:${PORT}" >&2
  exit 1
fi

echo "Migration status"
goose --no-color -dir migrations status

echo "Inspecting migration result"
docker exec "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" --format PrettyCompact \
  --query "SELECT database, name, engine FROM system.tables WHERE database IN ('default', 'raw', 'cleansed', 'curated', 'internal') ORDER BY database, name"

echo "Verifying firehose timeline MV routes new inserts"
SMOKE_CREATED_AT="$(docker exec "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" --format TSVRaw \
  --query "SELECT formatDateTime(now('UTC'), '%Y-%m-%d %H:%i:%S')")"
docker exec -i "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" \
  --query 'INSERT INTO default.github_events_stream FORMAT JSONEachRow' <<JSON
{"event_id":990000001,"event_type":"PushEvent","actor_login":"migration-smoke","actor_avatar":"https://avatars.example/migration-smoke","repo_name":"migration-smoke/timeline-repo","owner":"migration-smoke","created_at":"$SMOKE_CREATED_AT","action":"","ref_type":"branch","number":0,"title":null,"payload":"{\"ref\":\"refs/heads/main\",\"head\":\"abc123\",\"before\":\"def456\"}"}
JSON

TIMELINE_COUNT="$(docker exec "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" --format TSVRaw \
  --query "SELECT count() FROM curated.event_timeline WHERE repo_name = 'migration-smoke/timeline-repo' AND actor_login = 'migration-smoke'")"
[[ "$TIMELINE_COUNT" == "1" ]] || die "expected one timeline row after raw firehose insert, got ${TIMELINE_COUNT}"

TIMELINE_SUMMARY="$(docker exec "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" --format TSVRaw \
  --query "SELECT payload_summary FROM curated.event_timeline WHERE repo_name = 'migration-smoke/timeline-repo' AND actor_login = 'migration-smoke' LIMIT 1")"
[[ "$TIMELINE_SUMMARY" == "pushed to main" ]] || die "expected corrected push summary, got ${TIMELINE_SUMMARY}"

TIMELINE_EVENT_ID="$(docker exec "$CONTAINER" clickhouse-client \
  --user default --password "$PASSWORD" --format TSVRaw \
  --query "SELECT toString(event_id) FROM curated.event_timeline WHERE repo_name = 'migration-smoke/timeline-repo' AND actor_login = 'migration-smoke' LIMIT 1")"
[[ "$TIMELINE_EVENT_ID" == "990000001" ]] || die "expected timeline event_id 990000001, got ${TIMELINE_EVENT_ID}"

echo "Timeline MV smoke assertion passed: ${TIMELINE_SUMMARY}"

if [[ "$RUN_MIGRATION_ROLLBACK" == "1" ]]; then
  echo "Rolling back checked-in migrations"
  goose --no-color -dir migrations down-to 0

  echo "Rollback status"
  goose --no-color -dir migrations status
fi

echo "Local migration smoke test passed"
