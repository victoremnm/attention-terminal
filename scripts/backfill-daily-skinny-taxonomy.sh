#!/usr/bin/env bash
# Generalized data backfill script for daily_skinny_subject_hourly taxonomy rollups.
# Usage: ./scripts/backfill-daily-skinny-taxonomy.sh [days]
set -euo pipefail
cd "$(dirname "$0")/.."

DAYS="${1:-30}"
echo "Running daily skinny taxonomy backfill for ${DAYS} days..."
npx tsx scripts/backfill-daily-skinny-taxonomy.ts "${DAYS}"
