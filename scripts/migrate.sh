#!/bin/bash
# Run goose migrations against ClickHouse Cloud.
# Usage: ./scripts/migrate.sh up | down | status | version
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

export GOOSE_DRIVER=clickhouse
if [ -n "${CLICKHOUSE_URL:-}" ]; then
  export GOOSE_DBSTRING="$CLICKHOUSE_URL"
else
  export GOOSE_DBSTRING="clickhouse://${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}@${CLICKHOUSE_HOST}:9440/${CLICKHOUSE_DATABASE:-default}?secure=true"
fi
exec goose -dir migrations "$@"
