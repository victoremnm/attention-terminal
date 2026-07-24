#!/usr/bin/env bash
set -euo pipefail

# Helper script to persist read_only_analyst_role credentials & Data Policy metadata into 1Password

ITEM_ID="4innzk6cud7bz5v562i7tpgpki"

echo "Updating 1Password item ${ITEM_ID} with read_only_analyst credentials..."

if command -v op >/dev/null 2>&1; then
  op item edit "${ITEM_ID}" \
    "READ_ONLY_ROLE=read_only_analyst_role" \
    "READ_ONLY_USER=read_only_analyst" \
    "READ_ONLY_PASSWORD=ReadOnlyAnalyst2026!" \
    "DATA_POLICY=Priority 1 (curated.*) -> Priority 2 (cleansed.*) -> Priority 3 (default.*/raw.*) -> Priority 4 (internal.*/system.*)" \
    || echo "Note: 1Password CLI requires active session unlock."
else
  echo "1Password CLI (op) not found on PATH."
fi
