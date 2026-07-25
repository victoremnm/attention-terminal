#!/usr/bin/env bash
# Generalized data backfill script for daily_skinny_subject_hourly taxonomy rollups.
# Usage: ./scripts/backfill-daily-skinny-taxonomy.sh [days]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

DAYS="${1:-30}"
echo "Running daily skinny taxonomy backfill for ${DAYS} days..."
npx tsx "$SCRIPT_DIR/backfill-daily-skinny-taxonomy.ts" "${DAYS}"
