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
# GOOSE_DBSTRING needs the native clickhouse:// protocol on port 9440 -- CLICKHOUSE_URL
# (used elsewhere for HTTP/curl inserts) is an https://...:8443 REST endpoint and is
# not a valid goose DSN, so always build it from the individual HOST/USER/PASSWORD parts.
export GOOSE_DBSTRING="clickhouse://${CLICKHOUSE_USER:-}:${CLICKHOUSE_PASSWORD:-}@${CLICKHOUSE_HOST:-localhost}:9440/${CLICKHOUSE_DATABASE:-default}?secure=true"
exec goose -dir migrations "$@"
