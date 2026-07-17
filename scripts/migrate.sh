#!/bin/bash
# Run goose migrations against ClickHouse Cloud.
# Usage: ./scripts/migrate.sh up | down | status | version
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export GOOSE_DRIVER=clickhouse
export GOOSE_DBSTRING="clickhouse://${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}@${CLICKHOUSE_HOST}:9440/${CLICKHOUSE_DATABASE:-default}?secure=true"
exec goose -dir migrations "$@"
