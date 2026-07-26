#!/usr/bin/env bash
set -euo pipefail

UUID_PATTERN='[[:xdigit:]]{8}-[[:xdigit:]]{4}-[1-5][[:xdigit:]]{3}-[89abAB][[:xdigit:]]{3}-[[:xdigit:]]{12}'

matches=$(git grep -nI -E "$UUID_PATTERN" -- . \
  ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' \
  ':(exclude)yarn.lock' ':(exclude)bun.lockb' \
  ':(exclude)dist/**' ':(exclude).next/**' ':(exclude)out/**' \
  ':(exclude)build/**' ':(exclude)coverage/**' ':(exclude)node_modules/**' \
  2>/dev/null || true)

if [[ -n "$matches" ]]; then
  echo "Hardcoded UUID literals found in tracked source or documentation:"
  printf '%s\n' "$matches" | sed -E "s/$UUID_PATTERN/<UUID>/g"
  echo "Use ATTENTION_SESSION_ID or another runtime/environment value instead."
  exit 1
fi

echo "No hardcoded UUID literals found in tracked text files."
