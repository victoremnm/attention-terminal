# Blocked PR Protocol

When a PR receives the `blocked` label, it indicates a critical issue requiring resolution before merge. This guide applies to **all agents** (Claude, Gemini, Deepseek, Codex, etc.).

## Types of Blocking Issues

### 1. **CI Failures** (Technical blocker)
**Symptom:** Red X on GitHub Checks (Next.js build, Goose migrations, integration tests failing)

**Action:**
1. Review the failing check details
2. Identify root cause (syntax error, type mismatch, SQL error, etc.)
3. Fix the issue in code
4. Push fix to the same branch
5. Wait for CI to re-run and pass
6. Remove the `blocked` label when all checks pass

**Example:**
```bash
gh pr checks <NUMBER>  # View which check failed
# Read error logs, fix code
git add <files>
git commit -m "fix: resolve CI failure in <system>"
git push
```

---

### 2. **Merge Conflicts** (Technical blocker)
**Symptom:** GitHub shows "Can't automatically merge" message on PR

**Action:**
1. Fetch the latest main branch
2. Rebase your feature branch onto main
3. Resolve conflicts manually
4. Force-push to your feature branch (safe if you're the only author)
5. Verify CI passes after rebase
6. Remove `blocked` label once clean

**Example:**
```bash
git fetch origin
git rebase origin/main
# Resolve conflicts in your editor
git add <resolved-files>
git rebase --continue
git push --force-with-lease
```

---

### 3. **Unresolved Review Comments** (Critical blocker)
**Symptom:** PR shows "Conversations" tab with unresolved threads

**Action:**
1. Read all comments carefully
2. Determine if changes are required or if it's feedback-only
3. If changes required:
   - Make the code changes
   - Respond to the comment explaining your fix
   - Mark the comment as resolved
   - Push the change
4. If it's feedback for context (not a change request):
   - Reply with acknowledgment
   - Mark as resolved with permission
5. Remove `blocked` label only when reviewer explicitly approves

**Note:** Never resolve review comments without addressing the underlying concern.

---

### 4. **Product/Semantic Verification Needed** (Human decision required)
**Symptom:** PR has a checklist of items like "Confirm X matches product intent" or "Verify Y cost is acceptable"

**Action (Agent):**
1. Review the checklist items carefully
2. If you can verify them objectively (check code, run queries, compare specs):
   - Add a comment with detailed verification evidence
   - Link to test results, query proofs, etc.
   - Suggest the reviewer can now check the box
3. If verification requires human judgment (product semantics, business tradeoffs):
   - Add a comment summarizing the evidence you've gathered
   - Clearly state what still needs human decision
   - Do NOT guess at product intent — ask for clarification
4. Mark the PR as ready for human review with clear notes

**Example:** If a checklist says "Confirm ranking fields match product semantics," you would:
```
## Verification Evidence

✓ Code follows established ranking patterns (see src/lib/queries.ts:1234)
✓ Fields documented in PR body match schema
? Product semantics: Please confirm if "substantive_pushes" is the right metric
  to use for ranking, or if we should also consider PR velocity.
```

---

### 5. **Dependency Blocker** (Requires coordination)
**Symptom:** PR comment states "Depends on PR #X" or "Requires branch Y to merge first"

**Action (Agent):**
1. Identify the upstream dependency (the PR or branch this depends on)
2. Check if it's merged yet:
   ```bash
   gh pr view <UPSTREAM_PR> --json state  # Check if MERGED
   ```
3. If NOT merged:
   - Do NOT force-merge your PR
   - Add a comment: "Waiting for #X to merge (dependency)"
   - Mark as blocked
4. If merged:
   - Rebase your branch onto the merged changes
   - Verify CI passes
   - Remove blocked label

**Example:**
```bash
gh pr view 162 --json state  # Check dependency
# If "state": "MERGED", then:
git fetch origin
git rebase origin/main  # Brings in #162's commits
git push --force-with-lease
```

---

## Blocked Label Workflow

```
┌─────────────────┐
│ Agent creates PR│
└────────┬────────┘
         │
    ✓ CI passes? ──No──> Fix issues → CI passes
         │
    ✓ Mergeable? ──No──> Resolve conflicts → Mergeable
         │
    ✓ All reviews? ──No──> Address comments
         │
  ┌──────┴─────────┐
  │ Human review   │
  └──────┬─────────┘
         │
   ✓ Approved? ──No──> [BLOCKED LABEL ADDED]
         │                    │
        Yes                   └──> Agent fixes/clarifies
         │                         │
         └─────────────────────────┘
         │
    ┌────┴────────────────┐
    │ All checks pass?    │
    │ All reviews done?   │
    │ No blockers?        │
    └────┬─────────────────┘
         │
    Yes  │
    ┌────┴─────────────┐
    │ Merge to main    │
    └──────────────────┘
```

---

## Document Changes for Your PR

If you receive a `blocked` label:

1. **In the PR description**, add a "Blocking Issues" section:
   ```markdown
   ## Blocking Issues Discovered
   - [ ] Issue #1: [Specific problem]
   - [ ] Issue #2: [Specific problem]
   ```

2. **Comment on the PR** with your fix:
   ```
   Blocking issue resolved:
   - Issue #1: [Fixed by commit XYZ - explanation]
   - Issue #2: [Verified with evidence - link]
   
   Removed `blocked` label.
   ```

3. **Push changes** and verify CI passes before removing the label

---

## When to Ask for Help

If you receive a `blocked` label and:
- The blocking reason is unclear
- You've tried fixes but CI still fails
- You need clarification on product semantics
- The blocker is outside your control

**Comment on the PR clearly:**
```
Blocked PR #123 — need clarification:
- Original blocker was [X]
- I attempted [Y] but [Z] happened
- Could you clarify [question]?
```

Do NOT remove the blocked label yourself without resolving the issue.

---

## Examples by Agent Type

### Claude Agent (Any subagent)
1. Read blocking reason carefully
2. If technical: fix code, push, verify CI
3. If semantic: add detailed evidence comment, ask for explicit approval
4. Document changes in PR body
5. Remove label only after resolution confirmed

### Gemini/Deepseek/Other Models
Same protocol applies:
1. Same troubleshooting steps
2. Same documentation standards
3. Comment clearly with agent identity
4. Link evidence from tests/queries

---

## PR #166 Case Study

**Original State:**
- All CI passing ✓
- Code tested and verified ✓
- Blocked label added by human reviewer

**Blocking Items (from PR body):**
1. Confirm ranking fields match intended product semantics
2. Confirm branch/dependency attribution should remain unknown
3. Review query cost against production budget

**Resolution:**
- Item 1: Human decision required (can clarify in comment)
- Item 2: Already addressed in code (mark as confirmed)
- Item 3: Evidence available (188 ms, 2.6M rows scanned — acceptable)

**Action Taken:**
- Comment added with verification evidence
- Checklist items marked complete with links to proof
- Awaiting human approval to remove blocked label

---

## Summary

**For All Agents:**
- `blocked` label = stop, don't merge, investigate
- Fix technical issues (CI, conflicts) immediately
- For semantic issues: provide evidence, ask for explicit approval
- Document your findings and changes clearly
- Never guess at product intent — clarify instead
