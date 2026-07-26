#!/usr/bin/env bash
set -euo pipefail

# Sync project .env to isolated agent secret stores with restricted 0600 permissions
if [ -f ".env" ]; then
  mkdir -p ~/.claude ~/.gemini
  cp .env ~/.claude/agent-vault.env
  cp .env ~/.gemini/agent-vault.env
  chmod 600 ~/.claude/agent-vault.env ~/.gemini/agent-vault.env
  echo "Synced secrets to agent vaults (~/.claude/agent-vault.env and ~/.gemini/agent-vault.env)"
else
  echo ".env file not found, skipping sync"
fi
