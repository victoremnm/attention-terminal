#!/usr/bin/env bash
# Pre-push session telemetry reporter.
# Run before `git push` to log the current session's subagent activity
# to the PR as a comment, so every push is traceable to the agent runs
# that produced it.
#
# Usage: ./scripts/pre-push-telemetry.sh <PR_NUM> [session-id]
#
# If session-id is not provided, uses $ATTENTION_SESSION_ID or falls back
# to "opencode-session-$(date +%Y%m%d)".
#
# Reads ClickHouse creds from .env (auto-discovers from worktrees).
# Always exits 0 — telemetry must never block a push.

set -uo pipefail
PR_NUM="${1:-}"
SESSION_ID="${2:-${ATTENTION_SESSION_ID:-}}"

if [ -z "$PR_NUM" ]; then
  # Try to detect the PR number from the current branch
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [ -n "$BRANCH" ]; then
    PR_NUM=$(gh pr list --head "$BRANCH" --repo "$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)" --json number --jq '.[0].number // empty' 2>/dev/null || echo "")
  fi
fi

if [ -z "$PR_NUM" ]; then
  echo "[pre-push-telemetry] No PR number detected, skipping telemetry report."
  exit 0
fi

if [ -z "$SESSION_ID" ]; then
  SESSION_ID="opencode-session-$(date +%Y%m%d)"
fi

# Discover .env (walk up from script dir, check worktree patterns)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || echo .)"
env_file=""
check_dir="$SCRIPT_DIR"
for _ in 1 2 3 4 5; do
  if [ -f "$check_dir/.env" ]; then
    env_file="$check_dir/.env"
    break
  fi
  parent="$(dirname "$check_dir")"
  [ "$parent" = "$check_dir" ] && break
  check_dir="$parent"
done
if [ -z "$env_file" ] && echo "$SCRIPT_DIR" | grep -q '\.claude/worktrees'; then
  main_checkout="$(echo "$SCRIPT_DIR" | sed 's|/\.claude/worktrees/.*||')"
  [ -f "$main_checkout/.env" ] && env_file="$main_checkout/.env"
fi
if [ -n "$env_file" ]; then
  set -a; source "$env_file"; set +a
  : "${CLICKHOUSE_URL:="https://${CLICKHOUSE_HOST}:8443"}"
fi

if [ -z "${CLICKHOUSE_URL:-}" ]; then
  echo "[pre-push-telemetry] No CLICKHOUSE_URL, skipping telemetry report."
  exit 0
fi

# Query the session's subagent runs from ClickHouse
QUERY="SELECT
  ts,
  agent_type,
  model,
  latency_ms,
  input_tokens,
  output_tokens,
  ok,
  substr(replaceAll(spec_preview, '\n', ' '), 1, 80) AS spec
FROM subagent_runs
WHERE session_id = '${SESSION_ID}'
ORDER BY ts DESC
FORMAT TabSeparated"

ROWS=$(clickhouse-client --host="${CLICKHOUSE_HOST}" --port=9440 \
  --secure --user="${CLICKHOUSE_USER:-default}" --password="${CLICKHOUSE_PASSWORD:-}" \
  --database="${CLICKHOUSE_DATABASE:-default}" \
  --query="${QUERY}" 2>/dev/null || echo "")

if [ -z "$ROWS" ]; then
  echo "[pre-push-telemetry] No subagent runs found for session ${SESSION_ID}."
  exit 0
fi

# Build the telemetry comment
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TOKENS_IN=$(echo "$ROWS" | awk -F'\t' '{sum += $5} END {print sum}')
TOKENS_OUT=$(echo "$ROWS" | awk -F'\t' '{sum += $6} END {print sum}')
RUN_COUNT=$(echo "$ROWS" | wc -l | tr -d ' ')
OK_COUNT=$(echo "$ROWS" | awk -F'\t' '$7 == 1 {count++} END {print count+0}')

COMMENT_BODY="## Session telemetry for push ${COMMIT_SHA}

| Metric | Value |
|---|---|
| Session ID | \`${SESSION_ID}\` |
| Model | \`$(echo "$ROWS" | head -1 | awk -F'\t' '{print $3}')\` |
| Subagent runs | ${RUN_COUNT} |
| Successful runs | ${OK_COUNT} |
| Input tokens | ${TOKENS_IN} |
| Output tokens | ${TOKENS_OUT} |

### Subagent runs

| Timestamp | Agent type | Model | Latency (ms) | In tokens | Out tokens | OK | Spec |
|---|---|---|---|---|---|---|---|
$(echo "$ROWS" | awk -F'\t' '{printf "| %s | %s | %s | %s | %s | %s | %s | %s |\n", $1, $2, $3, $4, $5, $6, $7, $8}')

_Logged to \`subagent_runs\` → \`subagent_experiments\` view in ClickHouse._"

# Post the comment to the PR
REPO=$(git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||; s|\.git$||' || echo "")
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
fi
if [ -n "$REPO" ]; then
  TMPFILE=$(mktemp)
  printf '%s\n' "$COMMENT_BODY" > "$TMPFILE"
  # Ignore env-provided tokens for this call so an expired .env token cannot
  # override the authenticated GitHub CLI credential in the keychain.
  if env -u GITHUB_TOKEN -u GH_TOKEN gh pr comment "$PR_NUM" --repo "$REPO" --body-file "$TMPFILE" 2>&1; then
    echo "[pre-push-telemetry] Posted telemetry comment to PR #${PR_NUM}."
  else
    echo "[pre-push-telemetry] Failed to post comment (non-blocking)."
  fi
  rm -f "$TMPFILE"
else
  echo "[pre-push-telemetry] Could not determine repo, skipping comment."
fi

exit 0
