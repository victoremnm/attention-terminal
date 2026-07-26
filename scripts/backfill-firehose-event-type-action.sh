#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Usage: pause the firehose writers, then run with the assertion below.
# The script defaults to the next UTC hour; pass --cutoff for an exact retry.
npx tsx scripts/backfill-firehose-event-type-action.ts --writers-paused "$@"
