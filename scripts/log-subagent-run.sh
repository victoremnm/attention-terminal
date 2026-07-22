#!/usr/bin/env bash
# Log a subagent run to subagent_runs and subagent_api_events in ClickHouse.
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
#     --input-tokens 14500 \
#     --output-tokens 1200 \
#     --cost-usd 0.045 \
#     --ok 1
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
input_tokens=0
output_tokens=0
cost_usd=0
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
    --input-tokens) input_tokens="$2"; shift 2 ;;
    --output-tokens) output_tokens="$2"; shift 2 ;;
    --cost-usd) cost_usd="$2"; shift 2 ;;
    --ok) ok="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | head -20
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; shift ;;
  esac
done

# If tokens are unrecorded (0), estimate based on spec length, result length, and latency
if [ "${input_tokens:-0}" -eq 0 ]; then
  spec_len="${#spec}"
  input_tokens=$(( 1200 + spec_len * 3 + (latency_ms > 0 ? latency_ms / 20 : 1500) ))
fi

if [ "${output_tokens:-0}" -eq 0 ]; then
  res_len="${#result}"
  output_tokens=$(( 350 + res_len * 3 ))
fi

if [ "$(echo "${cost_usd:-0} == 0" | bc 2>/dev/null || echo "1")" -eq 1 ]; then
  # Basic model cost estimation
  case "$(echo "$model" | tr '[:upper:]' '[:lower:]')" in
    *pro*|*claude-3-5-sonnet*|*gpt-4o*)
      cost_usd=$(awk -v in_tok="$input_tokens" -v out_tok="$output_tokens" 'BEGIN { printf "%.4f", (in_tok * 0.000003) + (out_tok * 0.000015) }')
      ;;
    *glm*|*kimi*|*haiku*|*mini*)
      cost_usd=$(awk -v in_tok="$input_tokens" -v out_tok="$output_tokens" 'BEGIN { printf "%.4f", (in_tok * 0.000001) + (out_tok * 0.000003) }')
      ;;
    *)
      cost_usd=$(awk -v in_tok="$input_tokens" -v out_tok="$output_tokens" 'BEGIN { printf "%.4f", (in_tok * 0.000002) + (out_tok * 0.000006) }')
      ;;
  esac
fi

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

# Build the run row as JSON
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
  --argjson input_tokens "${input_tokens:-0}" \
  --argjson output_tokens "${output_tokens:-0}" \
  --argjson cost_usd "${cost_usd:-0}" \
  --argjson ok "${ok:-1}" \
  '{ts:$ts,session_id:$session_id,prompt_id:$prompt_id,agent_id:$agent_id,agent_type:$agent_type,effort_level:$effort_level,permission_mode:$permission_mode,cwd:$cwd,model:$model,platform:$platform,spec_hash:$spec_hash,spec_preview:$spec_preview,spec:$spec,result_hash:$result_hash,result_preview:$result_preview,result:$result,latency_ms:$latency_ms,input_tokens:$input_tokens,output_tokens:$output_tokens,cache_read_tokens:0,cache_creation_tokens:0,cost_usd:$cost_usd,ok:$ok}'
)"

# Build the api_event row as JSON
api_event_row="$(jq -nc \
  --arg ts "$ts" \
  --arg session_id "$session_id" \
  --arg prompt_id "$prompt_id" \
  --arg query_source "subagent" \
  --arg agent_name "${agent_id:-$agent_type}" \
  --arg model "$model" \
  --argjson input_tokens "${input_tokens:-0}" \
  --argjson output_tokens "${output_tokens:-0}" \
  --argjson cost_usd "${cost_usd:-0}" \
  --argjson duration_ms "${latency_ms:-0}" \
  '{ts:$ts,session_id:$session_id,prompt_id:$prompt_id,query_source:$query_source,agent_name:$agent_name,model:$model,input_tokens:$input_tokens,output_tokens:$output_tokens,cache_read_tokens:0,cache_creation_tokens:0,cost_usd:$cost_usd,duration_ms:$duration_ms}'
)"

# Load .env for ClickHouse creds
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
if [ -z "$env_file" ] && [ -f "$SCRIPT_DIR/../../.env" ]; then
  env_file="$SCRIPT_DIR/../../.env"
fi
if [ -n "$env_file" ]; then
  set -a; source "$env_file"; set +a
  : "${CLICKHOUSE_URL:="https://${CLICKHOUSE_HOST}:8443"}"
fi

if [ -n "${CLICKHOUSE_URL:-}" ]; then
  db="${CLICKHOUSE_DATABASE:-default}"
  printf '%s\n' "$row" | curl -sS --max-time 10 \
    --user "${CLICKHOUSE_USER:-default}:${CLICKHOUSE_PASSWORD:-}" \
    "${CLICKHOUSE_URL%/}/?query=INSERT%20INTO%20${db}.subagent_runs%20FORMAT%20JSONEachRow" \
    --data-binary @- >/dev/null 2>&1 || true

  printf '%s\n' "$api_event_row" | curl -sS --max-time 10 \
    --user "${CLICKHOUSE_USER:-default}:${CLICKHOUSE_PASSWORD:-}" \
    "${CLICKHOUSE_URL%/}/?query=INSERT%20INTO%20${db}.subagent_api_events%20FORMAT%20JSONEachRow" \
    --data-binary @- >/dev/null 2>&1 || true
else
  spool="${CLAUDE_TELEMETRY_SPOOL:-$HOME/.claude/telemetry/spool.ndjson}"
  mkdir -p "$(dirname "$spool")" 2>/dev/null || true
  printf '%s\n' "$row" >> "$spool" 2>/dev/null || true
fi

exit 0