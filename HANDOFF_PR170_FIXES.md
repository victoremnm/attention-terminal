# Handoff: PR #170 Fixes In Progress

**Status:** minCommits filter partially added, needs completion  
**Branch:** feat/issue-135-139-trending-controls  
**Deadline:** 12 PM PT July 23 (~11 hours)

## Quick Summary

✅ **Done this session:**
- Spawned 3 Sonnet agents → all delivered working PRs
- Resolved PR #169 merge conflicts (vitest.config.ts)
- Added `rfr` label to #168, #169 (ready for human review)
- Added `minCommits` field to RankingsPreferences interface
- Set `minCommits: 1` as default

⏳ **Still needed for #170:**
1. Complete sanitizePreferences() to handle minCommits
2. Add minCommits check to filtering logic
3. Add minCommits input UI to filters panel
4. Add refresh button for zero-result sorts
5. Test, push, add rfr label

## Detailed Steps

### Step 1: Complete rankings-preferences.ts sanitization

In `sanitizePreferences()` (~line 200), add:
```typescript
const minCommits = typeof raw.minCommits === "number" && Number.isFinite(raw.minCommits) && raw.minCommits >= 0 ? raw.minCommits : DEFAULT_PREFERENCES.minCommits;
```

Add to return object:
```typescript
return { mode, sortField, sortDirection, attentionColumns, activeColumns, minStars, hideBotOnly, minCommits };
```

### Step 2: Update RepoRankings.tsx filtering

Around line 285, add to filteredViews filter:
```typescript
if (isActiveSource && prefs.minCommits > 0 && view.distinctCommits < prefs.minCommits) return false;
```

### Step 3: Add UI for minCommits filter

In filters panel, add input field for min commits.

### Step 4: Add refresh button for empty state

When `filteredViews.length === 0`, show refresh button.

### Step 5: Complete

```bash
cd /Users/victorem/Code/Repositories/victoremnm/clickhouse-trigger-hackathon/.claude/worktrees/issue-135-139
npm test
git add src/lib/rankings-preferences.ts src/components/RepoRankings.tsx
git commit -m "feat: add minCommits filter and refresh button"
git push

cd /Users/victorem/Code/Repositories/victoremnm/clickhouse-trigger-hackathon
gh pr edit 170 --add-label rfr
```

## PR Status After Fixes

| PR | Status | Next Action |
|----|--------|-------------|
| #168 | rfr ✅ | Human review → merge |
| #169 | rfr ✅ | Human review → merge |
| #170 | rfr (after fixes) | Human review → merge |

Then: record demo, submit before 12 PM PT July 23
