---
name: personal-handover
description: Update HANDOVER.md and PROGRESS.md from recent git activity across repositories. Use when the user asks for a handover, session wrap-up, progress update, or cross-repo status summary.
---

# Personal Handover

Use this at session boundaries for multi-repo work.

## Workflow

1. Gather recent git activity across the workspace.
2. Capture active branches and dirty repos.
3. Update `PROGRESS.md` with completed work and next steps.
4. Update `HANDOVER.md` only when cross-session context matters.

## Gather Activity

```bash
REPOS_DIR="${REPOS_DIR:-$PWD}"

for d in "$REPOS_DIR"/*/; do
  [ -d "$d/.git" ] || continue
  repo=$(basename "$d")
  commits=$(cd "$d" && git log --oneline --since="24 hours ago" 2>/dev/null | head -5)
  branch=$(cd "$d" && git branch --show-current 2>/dev/null)
  status=$(cd "$d" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  [ -n "$commits" ] && printf "\n## %s\n%s\n" "$repo" "$commits"
  printf "%s: %s (%s uncommitted)\n" "$repo" "$branch" "$status"
done
```

## Keep

- what changed
- files or repos touched
- blockers
- next steps
