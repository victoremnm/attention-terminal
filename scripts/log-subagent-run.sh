#!/usr/bin/env bash
# Log a subagent run to subagent_runs in ClickHouse.
# Always exits 0 — telemetry must never fail a turn.
#
# Usage:
#   ./scripts/log-subagent-run.sh \
#     --session-id "opencode-session-1" \
#     --prompt-id "explore-1" \
#     --agent-id "explore-1" \
#     --agent-type "explore" \
#     --model "glm-5.2:cloud" \
#     --spec "Explore the drilldown implementation" \
#     --result "Comprehensive report of 12 items..." \
#     --latency-ms 45000 \
#     --ok 1
#
# If CLICKHOUSE_URL is unset, spools to ~/.claude/telemetry/spool.ndjson.
set -uo pipefail

# Defaults
session_id=""
prompt_id=""
agent_id=""
agent_type="explore"
effort_level="default"
permission_mode="read-only"
cwd=""
model="unknown"
platform="opencode"
spec=""
result=""
latency_ms=0
ok=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id) session_id="$2"; shift 2 ;;
    --prompt-id) prompt_id="$2"; shift 2 ;;
    --agent-id) agent_id="$2"; shift 2 ;;
    --agent-type) agent_type="$2"; shift 2 ;;
    --effort-level) effort_level="$2"; shift 2 ;;
    --permission-mode) permission_mode="$2"; shift 2 ;;
    --cwd) cwd="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    --platform) platform="$2"; shift 2 ;;
    --spec) spec="$2"; shift 2 ;;
    --result) result="$2"; shift 2 ;;
    --latency-ms) latency_ms="$2"; shift 2 ;;
    --ok) ok="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | head -20
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; shift ;;
  esac
done

# Hash the spec and result (sha256, fallback to shasum)
sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

spec_hash="$(sha "$spec")"
spec_preview="$(printf '%s' "$spec" | tr '\n\t' '  ' | head -c 300)"
result_hash="$(sha "$result")"
result_preview="$(printf '%s' "$result" | tr '\n\t' '  ' | head -c 300)"

ts="$(date -u +%Y-%m-%dT%H:%M:%S.000)"

# Build the row as JSON
row="$(jq -nc \
  --arg ts "$ts" \
  --arg session_id "$session_id" \
  --arg prompt_id "$prompt_id" \
  --arg agent_id "$agent_id" \
  --arg agent_type "$agent_type" \
  --arg effort_level "$effort_level" \
  --arg permission_mode "$permission_mode" \
  --arg cwd "$cwd" \
  --arg model "$model" \
  --arg platform "$platform" \
  --arg spec_hash "$spec_hash" \
  --arg spec_preview "$spec_preview" \
  --arg spec "$spec" \
  --arg result_hash "$result_hash" \
  --arg result_preview "$result_preview" \
  --arg result "$result" \
  --argjson latency_ms "${latency_ms:-0}" \
  --argjson ok "${ok:-1}" \
  '{ts:$ts,session_id:$session_id,prompt_id:$prompt_id,agent_id:$agent_id,agent_type:$agent_type,effort_level:$effort_level,permission_mode:$permission_mode,cwd:$cwd,model:$model,platform:$platform,spec_hash:$spec_hash,spec_preview:$spec_preview,spec:$spec,result_hash:$result_hash,result_preview:$result_preview,result:$result,latency_ms:$latency_ms,input_tokens:0,output_tokens:0,cache_read_tokens:0,cache_creation_tokens:0,cost_usd:0,ok:$ok}'
)"

# Load .env for ClickHouse creds (same pattern as migrate.sh).
# Worktrees don't have .env (it's gitignored), so check the main repo root
# too — walk up from the script dir until we find .env or hit the filesystem root.
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
# Also check common worktree parent patterns
if [ -z "$env_file" ] && [ -f "$SCRIPT_DIR/../../.env" ]; then
  env_file="$SCRIPT_DIR/../../.env"
fi
# Fall back to the main repo checkout (sibling of .claude/worktrees/)
if [ -z "$env_file" ]; then
  base_name="$(basename "$SCRIPT_DIR")"
  if [ "$base_name" = "agent-drilldown-enrichment" ] || echo "$SCRIPT_DIR" | grep -q '\.claude/worktrees'; then
    # We're in a worktree — find the main checkout
    main_checkout="$(echo "$SCRIPT_DIR" | sed 's|/\.claude/worktrees/.*||')"
    [ -f "$main_checkout/.env" ] && env_file="$main_checkout/.env"
  fi
fi
if [ -n "$env_file" ]; then
  set -a; source "$env_file"; set +a
  # CLICKHOUSE_URL is derived from CLICKHOUSE_HOST if not set (migrate.sh uses
  # the native protocol; this script uses the HTTP interface for curl).
  : "${CLICKHOUSE_URL:="https://${CLICKHOUSE_HOST}:8443"}"
fi

if [ -n "${CLICKHOUSE_URL:-}" ]; then
  db="${CLICKHOUSE_DATABASE:-default}"
  printf '%s\n' "$row" | curl -sS --max-time 10 \
    --user "${CLICKHOUSE_USER:-default}:${CLICKHOUSE_PASSWORD:-}" \
    "${CLICKHOUSE_URL%/}/?query=INSERT%20INTO%20${db}.subagent_runs%20FORMAT%20JSONEachRow" \
    --data-binary @- >/dev/null 2>&1 || true
else
  spool="${CLAUDE_TELEMETRY_SPOOL:-$HOME/.claude/telemetry/spool.ndjson}"
  mkdir -p "$(dirname "$spool")" 2>/dev/null || true
  printf '%s\n' "$row" >> "$spool" 2>/dev/null || true
fi

exit 0