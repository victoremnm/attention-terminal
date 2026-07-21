#!/usr/bin/env bash
# scan.sh — Fast grep-based security scanner for changed files
# Usage: bash scan.sh [--staged | --head | --all | <file1> <file2> ...]
# Returns exit code 1 if any BLOCK findings exist, 0 otherwise.
#
# Checks performed:
#   1. Secret patterns (API keys, private keys, hardcoded credentials)
#   2. Hardcoded IPs in non-test files
#   3. localhost URLs in non-test/non-dev files
#   4. Unquoted $VAR in shell scripts
#   5. .gitignore coverage of sensitive patterns
#   6. LLM prompt strings with direct API response interpolation
#   7. Supply chain: npm/Cargo typosquats + unpinned versions

set -euo pipefail

# ---------------------------------------------------------------------------
# Color / emoji helpers (disabled if not a TTY)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'
else
  RED=''; YELLOW=''; GREEN=''; RESET=''
fi

BLOCK_COUNT=0
WARN_COUNT=0
PASS_COUNT=0

block() { echo -e "${RED}BLOCK ❌  $*${RESET}"; (( BLOCK_COUNT++ )) || true; }
warn()  { echo -e "${YELLOW}WARN  ⚠️   $*${RESET}"; (( WARN_COUNT++ ))  || true; }
pass()  { echo -e "${GREEN}PASS  ✅  $*${RESET}"; (( PASS_COUNT++ ))  || true; }

# ---------------------------------------------------------------------------
# Determine file list
# ---------------------------------------------------------------------------
MODE="${1:-}"
shift || true

if [[ "$MODE" == "--staged" ]]; then
  mapfile -t FILES < <(git diff --staged --name-only --diff-filter=ACMR 2>/dev/null || true)
elif [[ "$MODE" == "--head" ]]; then
  mapfile -t FILES < <(git diff --name-only HEAD~1 HEAD --diff-filter=ACMR 2>/dev/null || true)
elif [[ "$MODE" == "--all" ]]; then
  mapfile -t FILES < <(git ls-files 2>/dev/null || true)
elif [[ -n "$MODE" ]]; then
  FILES=("$MODE" "$@")
else
  mapfile -t FILES < <(git diff --staged --name-only --diff-filter=ACMR 2>/dev/null || true)
  if [[ ${#FILES[@]} -eq 0 ]]; then
    mapfile -t FILES < <(git diff --name-only HEAD~1 HEAD --diff-filter=ACMR 2>/dev/null || true)
  fi
fi

# Filter to files that actually exist on disk
EXISTING_FILES=()
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] && EXISTING_FILES+=("$f")
done
FILES=("${EXISTING_FILES[@]}")
FILE_COUNT=${#FILES[@]}

echo ""
echo "🔍 Security Scrub — ${FILE_COUNT} file(s) changed"
echo "---------------------------------------------------"

if [[ $FILE_COUNT -eq 0 ]]; then
  pass "No changed files to scan"
  echo ""
  echo "Summary: 0 BLOCK, 0 WARN, 1 PASS"
  exit 0
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
is_test_file() {
  local f="$1"
  [[ "$f" =~ (test|spec|__tests__|fixtures|\.test\.|\.spec\.|_test\.|_spec\.|\.dev\.) ]] && return 0
  [[ "$f" =~ (^tests?/|^spec/|^__tests__/) ]] && return 0
  return 1
}

is_dev_config_file() {
  local f="$1"
  [[ "$f" =~ (docker-compose|\.env\.example|\.env\.sample|devcontainer|dev\.config|\.dev\.) ]] && return 0
  return 1
}

# ---------------------------------------------------------------------------
# CHECK 1 — Secret patterns
# ---------------------------------------------------------------------------
SECRET_FOUND=0
SECRET_PATTERNS=(
  'sk-[A-Za-z0-9_-]{20,}'
  'ghp_[A-Za-z0-9]{36}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'
  '[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*=\s*["'"'"'][^"'"'"']{4,}'
  '[Ss][Ee][Cc][Rr][Ee][Tt]\s*=\s*["'"'"'][^"'"'"']{4,}'
  '[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]\s*=\s*["'"'"'][^"'"'"']{4,}'
  '[Tt][Oo][Kk][Ee][Nn]\s*=\s*["'"'"'][^"'"'"']{4,}'
)
for f in "${FILES[@]}"; do
  for pat in "${SECRET_PATTERNS[@]}"; do
    while IFS=: read -r _ linenum match; do
      block "${f}:${linenum} — hardcoded secret: $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
      SECRET_FOUND=1
    done < <(grep -nEi "$pat" "$f" 2>/dev/null || true)
  done
done
[[ $SECRET_FOUND -eq 0 ]] && pass "No hardcoded secret patterns found"

# ---------------------------------------------------------------------------
# CHECK 2 — Hardcoded IPs (non-test files only)
# ---------------------------------------------------------------------------
IP_FOUND=0
for f in "${FILES[@]}"; do
  is_test_file "$f" && continue
  while IFS=: read -r _ linenum match; do
    ip=$(echo "$match" | grep -oE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' | head -1)
    case "$ip" in
      127.0.0.1|0.0.0.0|255.255.255.255) continue ;;
    esac
    first=$(echo "$ip" | cut -d. -f1)
    second=$(echo "$ip" | cut -d. -f2)
    # Skip private ranges
    [[ "$first" == "10" ]] && continue
    [[ "$first" == "192" && "$second" == "168" ]] && continue
    if [[ "$first" == "172" ]] && [[ "$second" -ge 16 ]] && [[ "$second" -le 31 ]]; then continue; fi
    warn "${f}:${linenum} — hardcoded public IP: ${ip}"
    IP_FOUND=1
  done < <(grep -nE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$f" 2>/dev/null || true)
done
[[ $IP_FOUND -eq 0 ]] && pass "No suspicious hardcoded IPs found"

# ---------------------------------------------------------------------------
# CHECK 3 — localhost URLs in non-test/non-dev files
# ---------------------------------------------------------------------------
LOCALHOST_FOUND=0
for f in "${FILES[@]}"; do
  is_test_file "$f"       && continue
  is_dev_config_file "$f" && continue
  while IFS=: read -r _ linenum match; do
    warn "${f}:${linenum} — localhost URL in non-dev file: $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
    LOCALHOST_FOUND=1
  done < <(grep -nEi 'https?://(localhost|127\.0\.0\.1)(:[0-9]+)?' "$f" 2>/dev/null || true)
done
[[ $LOCALHOST_FOUND -eq 0 ]] && pass "No localhost URLs in production files"

# ---------------------------------------------------------------------------
# CHECK 4 — Shell scripts: unquoted variable interpolation risk
# ---------------------------------------------------------------------------
SHELL_FOUND=0
for f in "${FILES[@]}"; do
  [[ "$f" =~ \.(sh|bash|zsh)$ ]] || continue
  while IFS=: read -r _ linenum match; do
    trimmed=$(echo "$match" | sed 's/^[[:space:]]*//')
    [[ "$trimmed" =~ ^# ]] && continue
    [[ "$trimmed" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && continue
    [[ "$trimmed" =~ ^(readonly|export|local)[[:space:]] ]] && continue
    # Only flag if $VAR appears outside of double quotes
    if echo "$trimmed" | grep -qE '(^|[^"])\$[A-Za-z_][A-Za-z0-9_]+([^"]|$)' 2>/dev/null; then
      warn "${f}:${linenum} — unquoted \$VAR in shell (word-splitting risk): $(echo "$trimmed" | head -c 80)"
      SHELL_FOUND=1
    fi
  done < <(grep -nE '\$[A-Za-z_][A-Za-z0-9_]+' "$f" 2>/dev/null || true)
done
[[ $SHELL_FOUND -eq 0 ]] && pass "No unquoted shell variable patterns flagged"

# ---------------------------------------------------------------------------
# CHECK 5 — .gitignore coverage
# ---------------------------------------------------------------------------
GITIGNORE_ISSUES=()
REQUIRED_PATTERNS=('.env' '*.pem' '*.key' 'output/' '*.secret')
if [[ -f ".gitignore" ]]; then
  for pat in "${REQUIRED_PATTERNS[@]}"; do
    grep -qF "$pat" .gitignore 2>/dev/null || GITIGNORE_ISSUES+=("$pat")
  done
  if [[ ${#GITIGNORE_ISSUES[@]} -eq 0 ]]; then
    pass ".gitignore covers all sensitive patterns"
  else
    for missing in "${GITIGNORE_ISSUES[@]}"; do
      warn ".gitignore missing pattern: ${missing}"
    done
  fi
else
  warn "No .gitignore found in working directory"
fi

# ---------------------------------------------------------------------------
# CHECK 6 — LLM prompt injection risk
# ---------------------------------------------------------------------------
PROMPT_FOUND=0
for f in "${FILES[@]}"; do
  is_test_file "$f" && continue
  # Python: f-string with API/user data in prompt variable
  while IFS=: read -r _ linenum match; do
    warn "${f}:${linenum} — possible prompt injection: API/user data interpolated into LLM prompt: $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
    PROMPT_FOUND=1
  done < <(grep -nE '(prompt|message|system_prompt|user_msg)\s*[+]?=\s*f["'"'"'].*\{.*(response|result|output|user_input|data)\}' "$f" 2>/dev/null || true)

  # JS/TS: template literal with variable in prompt context
  while IFS=: read -r _ linenum match; do
    warn "${f}:${linenum} — possible prompt injection: variable interpolated in template literal prompt: $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
    PROMPT_FOUND=1
  done < <(grep -nE '(prompt|content|message)\s*[:=]\s*`[^`]*\$\{[^}]*(response|result|output|userInput|user_input)[^}]*\}' "$f" 2>/dev/null || true)
done
[[ $PROMPT_FOUND -eq 0 ]] && pass "No suspicious LLM prompt interpolation patterns found"

# ---------------------------------------------------------------------------
# CHECK 7 — Supply chain: typosquats + unpinned versions
# ---------------------------------------------------------------------------
NPM_TYPOSQUATS=(
  'lodahs' 'coloers' 'reqeusts' 'crossenv' 'event-stream'
  'node-ipc' 'momment' 'babelcli' 'mongoos'
  'electorn' 'recat' 'npmrc-config' 'axios-proxy-fix'
)
CARGO_TYPOSQUATS=(
  'reqwests' 'tokoi' 'axun' 'serede' 'serder'
  'tokio2' 'actix-webs' 'rocketrs'
)

SUPPLY_FOUND=0
for f in "${FILES[@]}"; do
  if [[ "$(basename "$f")" == "package.json" ]]; then
    for pkg in "${NPM_TYPOSQUATS[@]}"; do
      while IFS=: read -r _ linenum match; do
        block "${f}:${linenum} — known npm typosquat '${pkg}': $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
        SUPPLY_FOUND=1
      done < <(grep -nF "\"${pkg}\"" "$f" 2>/dev/null || true)
    done
    while IFS=: read -r _ linenum match; do
      warn "${f}:${linenum} — unpinned version (* or latest) is a supply-chain risk: $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
      SUPPLY_FOUND=1
    done < <(grep -nE ':\s*"(\*|latest)"' "$f" 2>/dev/null || true)
  fi

  if [[ "$(basename "$f")" == "Cargo.toml" ]]; then
    for pkg in "${CARGO_TYPOSQUATS[@]}"; do
      while IFS=: read -r _ linenum match; do
        block "${f}:${linenum} — known Cargo typosquat '${pkg}': $(echo "$match" | sed 's/^[[:space:]]*//' | head -c 80)"
        SUPPLY_FOUND=1
      done < <(grep -niE "^[[:space:]]*${pkg}\s*=" "$f" 2>/dev/null || true)
    done
  fi
done
[[ $SUPPLY_FOUND -eq 0 ]] && pass "No supply chain issues found (no typosquats or unpinned versions)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "---------------------------------------------------"
echo "Summary: ${BLOCK_COUNT} BLOCK, ${WARN_COUNT} WARN, ${PASS_COUNT} PASS"

if [[ $BLOCK_COUNT -gt 0 ]]; then
  echo -e "${RED}BLOCKED: Fix issues above before pushing.${RESET}"
  exit 1
elif [[ $WARN_COUNT -gt 0 ]]; then
  echo -e "${YELLOW}WARNINGS: Review items above. Push at your discretion.${RESET}"
  exit 0
else
  echo -e "${GREEN}All checks passed. Safe to push.${RESET}"
  exit 0
fi
