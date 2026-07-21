---
name: address-feedback
description: Address open feedback from code review tools (CodeRabbit, Copilot, Codex, Claude Code Action) and live preview comments (Vercel Toolbar). USE WHEN user says "address feedback", "fix coderabbit", "fix copilot comments", "fix codex comments", "fix claude comments", "address review comments", "handle PR feedback", "address vercel comments", "check preview feedback", OR needs to systematically resolve automated code review issues or human comments left on a Vercel preview deployment.
version: 1.3.0
---

# Address Feedback

Systematically fetch, resolve, and **reply to** feedback from automated code review tools that leave GitHub PR comments, and from human reviewers who leave live comments on a Vercel preview deployment via the Vercel Toolbar.

**Key behavior:** After addressing each feedback point, automatically post a reply on behalf of the user explaining what was fixed and how — on GitHub for GitHub-native sources, and on the Vercel Toolbar thread itself (plus a collated GitHub summary) for Vercel feedback.

---

## Supported Sources

| Source | Detection | Fetch Method |
| -------- | ----------- | -------------- |
| **CodeRabbit** | `coderabbit` user in PR comments | GitHub API |
| **Copilot** | `copilot` user in PR reviews | GitHub API |
| **Codex** | `chatgpt-codex-connector` user in PR review threads (P1/P2/P3 badges) | GitHub API (review threads) |
| **Claude Code Action** | `github-actions[bot]` with Claude signature | GitHub API |
| **Vercel Toolbar** | `.vercel/project.json` exists in repo root | Vercel MCP tools (`list_toolbar_threads` etc.) |

> **Note:** For quality evaluation during development, use the `telemetry-judge` skill directly (`/judge this`). CodeRabbit/Copilot/Claude Code Action are automated-review sources reachable via GitHub API; Vercel Toolbar is **live human feedback** on a running preview deployment, fetched via MCP instead — see its own subsections below, since its fetch/reply/triage mechanics differ from the GitHub-native sources.

---

## Quick Start

```bash
# Auto-detect and address all feedback on current PR (checks GitHub sources + Vercel if linked)
> address feedback

# Specific source
> address coderabbit feedback
> address copilot comments
> address claude comments
> address vercel comments
> check preview feedback
```text

---

## Phase 1: Identify Feedback Source

### Determine PR Context

> **Note:** Execute in a subshell or script context. The `exit 1` terminates the script on failure; in interactive shells, handle the error differently.

```bash
# Get current branch and PR number
BRANCH=$(git branch --show-current)
PR_NUM=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number')

# Exit if no PR found for current branch
if [ -z "$PR_NUM" ] || [ "$PR_NUM" = "null" ]; then
  echo "No PR found for branch $BRANCH"
  # Fall back: list recent PRs by user
  gh pr list --author "@me" --state open --json number,title,headRefName --jq '.[:5]'
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

**If no PR exists:** Ask the user which PR to address, or if they want to create one first.

### Detect Vercel Toolbar Availability

```bash
# Vercel Toolbar comments only exist if this repo is linked to a Vercel project
if [ -f .vercel/project.json ]; then
  PROJECT_ID=$(jq -r '.projectId' .vercel/project.json)
  TEAM_ID=$(jq -r '.orgId' .vercel/project.json)
else
  echo "Not linked to Vercel — run 'vercel link --yes' first if you expect Toolbar feedback, otherwise skip this source."
fi
```

If `.vercel/project.json` is missing but the user explicitly asked to "address vercel comments", run `vercel link --yes` first (see the `vercel:bootstrap`/`vercel:env` skills for the full linking flow) before giving up on the source.

---

## Phase 2: Fetch Feedback

### CodeRabbit Comments

```bash
# Fetch inline review comments from CodeRabbit
gh api "repos/${REPO}/pulls/${PR_NUM}/comments" \
  --jq '.[] | select(.user.login | test("coderabbit"; "i")) | {
    id: .id,
    path: .path,
    line: .line,
    body: .body,
    created: .created_at
  }'

# Fetch review summary
gh api "repos/${REPO}/pulls/${PR_NUM}/reviews" \
  --jq '.[] | select(.user.login | test("coderabbit"; "i")) | {
    id: .id,
    state: .state,
    body: .body
  }'
```text

### Copilot Review Comments

```bash
# Fetch review comments from Copilot
gh api "repos/${REPO}/pulls/${PR_NUM}/comments" \
  --jq '.[] | select(.user.login | test("copilot"; "i")) | {
    id: .id,
    path: .path,
    line: .line,
    body: .body,
    created: .created_at
  }'

# Fetch Copilot review summaries
gh api "repos/${REPO}/pulls/${PR_NUM}/reviews" \
  --jq '.[] | select(.user.login | test("copilot"; "i")) | {
    id: .id,
    state: .state,
    body: .body
  }'
```

### Claude Code Action Comments

Claude Code Action (`anthropics/claude-code-action@v1`) posts reviews via `github-actions[bot]`:

```bash
# Fetch Claude Code Action review comments
# These appear as github-actions[bot] comments containing Claude's review
gh api "repos/${REPO}/pulls/${PR_NUM}/comments" \
  --jq '.[] | select(.user.login == "github-actions[bot]") | select(.body | test("Claude|claude-code"; "i")) | {
    id: .id,
    path: .path,
    line: .line,
    body: .body,
    created: .created_at
  }'

# Also check issue comments for summary reviews
gh api "repos/${REPO}/issues/${PR_NUM}/comments" \
  --jq '.[] | select(.user.login == "github-actions[bot]") | select(.body | test("Claude|claude-code"; "i")) | {
    id: .id,
    body: .body,
    created: .created_at
  }'
```text

> **Setup:** To enable Claude Code Action reviews, add the workflow to your repo. See [claude-code-action](https://github.com/anthropics/claude-code-action) for setup instructions.

### Vercel Toolbar Comments

**These do NOT show up in `gh api .../pulls/comments` or `.../reviews`.** A human reviewer clicking through the live Vercel preview deployment and leaving inline comments via the Vercel Toolbar creates threads that live entirely in Vercel's system. The only trace visible on GitHub is the `vercel[bot]` status/check comment showing a `💬 N unresolved` count with no text — the actual comment content must be fetched via the Vercel MCP tools.

```
mcp__claude_ai_Vercel__list_toolbar_threads({
  teamId: TEAM_ID,        // from .vercel/project.json's orgId
  projectId: PROJECT_ID,  // from .vercel/project.json's projectId
  status: "unresolved",
  page: "/specific-route"  // optional: scope to one page under review
})
```

Each returned thread includes the comment text, a `webUrl` back to the thread, the branch it was left on, and a `frameworkContext`/`selector` snapshot of the exact DOM element clicked — usually enough to identify which component/chart/row the comment refers to without guessing.

---

## Phase 3: Triage and Prioritize

### Priority Order (GitHub-native automated sources)

1. **Security issues** - SQL injection, XSS, command injection
2. **Correctness issues** - Logic errors, race conditions, data corruption
3. **Performance issues** - Memory leaks, N+1 queries, inefficient algorithms
4. **Code quality** - Error handling, edge cases, bounds checking
5. **Style/nitpicks** - Naming, formatting, unused imports

### Vercel Toolbar triage (different axis — human/product feedback)

Automated review bots almost always mean "fix this in the current PR." A human clicking through a live preview is a different signal — their comments span everything from real bugs to brand-new feature requests to pure opinion. Classify each thread into exactly one bucket before touching code:

- **Bug** — the shipped page doesn't do what the PR claims (wrong color, broken layout, crash, bad data rendering, illegible text). Fix in the current PR.
- **Feature request** — a new capability not in the PR's original scope (e.g. "can we also show X broken down by Y"). Do **not** scope-creep the open PR to build it. Record it in the PR body's Follow-up section instead, and say so in the reply.
- **Nit/duplicate** — same root cause as another already-triaged thread (e.g. two comments both pointing at one illegible chart). Fix once, close both, cross-reference in both replies.

Getting this distinction wrong is the single biggest risk with this feedback source: silently building out every feature request bloats the PR and breaks the "smallest reasonable stacked slice" convention most repos want. When in doubt, ask the user rather than assuming a request should be built now.

### Create Todo List

For each piece of feedback, create a tracking item:

```text

- [ ] [HIGH] Fix SQL injection in user_service.py:45
- [ ] [MED] Add bounds checking for timestamp arithmetic
- [ ] [LOW] Extract magic number to named constant

```text

---

## Phase 4: Address Each Issue

### Workflow Per Issue

1. **Read the feedback** - Understand what's being requested
2. **Read the code** - Look at the file/line mentioned
3. **Understand context** - Read surrounding code for full picture
4. **Implement fix** - Make the minimal change that addresses the issue
5. **Verify fix** - Run tests if applicable
6. **Auto-reply to comment** - Post a reply on GitHub explaining the fix

### Auto-Reply Protocol (IMPORTANT)

**After fixing each issue, immediately reply to the comment on the user's behalf.**

Reply format:

```text
Fixed in <commit_sha>

<Brief explanation of what was changed and why>
```text

Example replies:

**For bounds checking issue:**

```text
Fixed in abc1234

Added bounds checking before subtraction to prevent underflow:
`if timestamp > offset { timestamp - offset } else { 0 }`
```text

**For missing error handling:**

```text
Fixed in def5678

Added Result handling with proper error propagation. The function now returns `Result<T, Error>` and uses `?` operator for error propagation instead of unwrap().
```text

**For security issue:**

```text
Fixed in ghi9012

Replaced string interpolation with parameterized query to prevent SQL injection:
`SELECT * FROM users WHERE id = $1` with prepared statement.
```text

This ensures:

- The feedback loop is closed
- The reviewer knows the issue was addressed
- Future readers can trace the fix to a specific commit

### Common Issue Patterns

| Issue | Fix Pattern |
| ------- | ------------- |
| Missing error handling | Add try/catch, Result/Option handling |
| Clock skew / underflow | Add bounds checking: `if a > b { a - b } else { 0 }` |
| Magic numbers | Extract to `const TIMEOUT_MS: u64 = 5000;` |
| SQL injection | Use parameterized queries |
| Unused imports | Remove or mark with `#[allow(unused)]` / `# noqa` |
| Missing null check | Add early return or guard clause |
| Race condition | Add mutex/lock or use atomic operations |

---

## Phase 5: Auto-Reply on User's Behalf

### Reply Commands (Execute These Automatically)

**For inline comments (reply directly to the comment thread):**

```bash
# Get the comment ID from the fetched feedback
COMMENT_ID=<id from fetch>
COMMIT_SHA=$(git rev-parse --short HEAD)
EXPLANATION="<explanation of fix>"

# Construct multi-line body safely
REPLY_BODY=$(printf "Fixed in %s\n\n%s" "${COMMIT_SHA}" "${EXPLANATION}")

# Post reply to the specific comment
gh api "repos/${REPO}/pulls/${PR_NUM}/comments/${COMMENT_ID}/replies" \
  -f body="${REPLY_BODY}"
```

**For review-level summary comments:**

```bash
# Post a summary comment on the PR
gh pr comment ${PR_NUM} --body "## Feedback Addressed

### CodeRabbit/Copilot Issues Fixed:

- [x] **user_service.py:45** - Fixed SQL injection with parameterized query
- [x] **timestamp.rs:123** - Added bounds checking for underflow protection
- [x] **config.py:67** - Extracted magic numbers to named constants

All issues addressed in commit $(git rev-parse --short HEAD)"
```text

### CRITICAL: Always Reply

**DO NOT** silently fix issues. Every addressed feedback point MUST have a corresponding reply comment. This is non-negotiable because:

1. **Closes the loop** - Automated tools track resolved vs open feedback
2. **Audit trail** - Future reviewers can see what was done
3. **Confirms understanding** - Shows the fix actually addressed the concern
4. **Unblocks merge** - Many repos require comment resolution before merge

### Acknowledge Claude Code Action Feedback

For Claude Code Action reviews, address specific suggestions:

```markdown
Fixed in abc1234

Addressed Claude's review:

- Improved error handling as suggested
- Added the missing validation check
- Refactored for clarity per review comment

```

---

## Phase 5b: Vercel Toolbar — Reply, Resolve, and Collate (DRY)

Vercel Toolbar threads need **two** things closed out, not one — the thread itself, and a durable record on the PR (since nothing about Vercel comments is otherwise visible from GitHub):

### 1. Reply directly on the thread

```
mcp__claude_ai_Vercel__reply_to_toolbar_thread({
  teamId: TEAM_ID,
  threadId: THREAD_ID,
  markdown: "Fixed in `<sha>`. <one-line root cause + what changed>. See [PR #<n>](<pr-url>)."
})
```

For a deferred feature request, reply explaining *why* it's deferred and where it's tracked, not just "not doing this":

```
mcp__claude_ai_Vercel__reply_to_toolbar_thread({
  teamId: TEAM_ID,
  threadId: THREAD_ID,
  markdown: "Good idea, but out of scope for this single-purpose PR — <one-line reason>. Tracked in the Follow-up section of PR #<n>."
})
```

### 2. Resolve the thread

```
mcp__claude_ai_Vercel__change_toolbar_thread_resolve_status({ teamId: TEAM_ID, threadId: THREAD_ID, resolved: true })
```

"Addressed" means either fixed-in-commit or explicitly deferred with a tracked follow-up — both are valid reasons to resolve. Never resolve a thread without replying first.

### 3. Collate into ONE GitHub PR comment — post once, edit in place

Don't post a new GitHub comment per Vercel thread (not DRY) and don't rely on Vercel replies alone as the only record (invisible to anyone not clicking into Vercel). Instead:

**First pass** — post a single markdown table, one row per thread, and capture the comment ID:

```bash
gh api "repos/${REPO}/issues/${PR_NUM}/comments" -X POST -f body="$(cat <<'EOF'
## 🔍 Live preview feedback (Vercel Toolbar)

| # | Location | Comment | Type | Status |
|---|---|---|---|---|
| 1 | [`/page` → Component](https://vercel.com/.../c/THREAD_ID) | "comment text" | Bug | 🔄 In progress |
| 2 | [`/page` → Other component](https://vercel.com/.../c/THREAD_ID2) | "comment text" | Feature request | 📋 Deferred — see Follow-up |
EOF
)" --jq '.id'
```

**Every subsequent pass** — edit that SAME comment (never post a new one):

```bash
gh api -X PATCH "repos/${REPO}/issues/comments/${COMMENT_ID}" -f body="$(cat <<'EOF'
<same table, statuses updated to "✅ Fixed in `<sha>`" or "📋 Deferred — tracked in Follow-up">
EOF
)"
```

`gh pr edit`/`gh api ... -f body=@file` can silently no-op on some GitHub API paths that also return a deprecated-Projects-classic GraphQL warning — after any body update, always re-fetch (`gh pr view <n> --json body` or `gh api .../issues/comments/<id>`) and grep for something unique to your edit to confirm it actually landed before moving on.

If the PR body has a "Follow-up" section (see this repo's own PR conventions), add deferred feature requests there too, not just in the collated comment — the comment is the live-feedback audit trail, the PR body is the durable spec of what shipped vs. what didn't.

---

## Phase 6: Poll for Feedback and Drive to Zero Unresolved (REQUIRED)

This phase is **mandatory** and defines the exit criterion for the whole skill: the pass is **not complete until every review thread is resolved and CI is green.** Automated reviewers (CodeRabbit, Copilot, **Codex**, Claude Code Action) post asynchronously and **re-review after every push** — a single fetch-fix-reply pass is never sufficient. You MUST poll, and replying is NOT the same as resolving.

### Why this matters

Most protected branches enable **"require conversation resolution"** — an unresolved review thread blocks merge even when CI is green and you've already replied. `gh pr merge` fails with `"base branch policy prohibits the merge"`. So every comment must end in a **resolved** state, not just a replied-to state.

### The three-outcome triage (every comment lands in exactly one, all end resolved)

| Outcome | When | Action |
|---|---|---|
| **Acknowledged** | Valid and in-scope for this PR | Fix it → reply `Fixed in <sha>` with what changed → **resolve the thread**. |
| **Irrelevant** | Wrong, not applicable, or a false positive | Reply explaining *specifically* why it doesn't apply → **resolve the thread** (close it). Never resolve silently. |
| **Relevant but out of scope** | A real point, but not this PR's job | **Defer**: file a GitHub issue that quotes/links the comment, reply `Tracked in #NN` → **resolve the thread**. |

Never leave a thread unresolved "to be safe" — that is precisely what blocks the merge. If you genuinely can't decide fix-vs-defer, ask the user; don't leave it open.

### Resolve a GitHub review thread (this is the step the old skill was missing)

Replying via `.../comments/{id}/replies` does **not** resolve the thread. Resolve it explicitly via GraphQL, using the thread's **node id** (not the comment's databaseId — fetch both):

```bash
# Fetch unresolved threads WITH their node id + first comment databaseId
env -u GITHUB_TOKEN gh api graphql -f query='query($n:Int!){repository(owner:"OWNER",name:"REPO"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:1){nodes{databaseId author{login} body}}}}}}}' -F n=PR_NUM \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | {threadId:.id, commentDbId:.comments.nodes[0].databaseId, author:.comments.nodes[0].author.login, path, line}'

# Reply to the comment (databaseId), THEN resolve the thread (node id)
env -u GITHUB_TOKEN gh api "repos/OWNER/REPO/pulls/PR_NUM/comments/COMMENT_DB_ID/replies" -f body="Fixed in <sha>. <what changed>"
env -u GITHUB_TOKEN gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -F t=THREAD_NODE_ID --jq '.data.resolveReviewThread.thread.isResolved'
```

### Poll loop

After each push, poll until the reviewers have weighed in on the **new** commit (they re-review every push), then re-fetch and triage the fresh threads. Repeat until the unresolved count is zero. Respect the user's global CI-cadence rule (check at most ~every 3 min, bounded iterations) — a Monitor on `gh pr checks` plus a re-fetch of threads after each reviewer round is the intended shape.

```bash
# The single merge-readiness signal: unresolved review threads
env -u GITHUB_TOKEN gh api graphql -f query='query($n:Int!){repository(owner:"OWNER",name:"REPO"){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}' -F n=PR_NUM \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)]|length'
```

### Exit criterion (hard gate — do not report done until both hold)

Re-verify AFTER the final push:
1. **Unresolved review threads == 0** (query above), and
2. Required CI checks are green.

Report the final unresolved count and CI state explicitly. If a new comment arrives after you believe you're done, **you are not done** — loop again. Only then is the PR merge-eligible.

> **Env caveat:** if `GITHUB_TOKEN` is exported in your shell (e.g. auto-sourced from a project `.env`), `gh` picks it up and can fail with `401 Bad credentials`. Run every `gh` command as `env -u GITHUB_TOKEN gh ...` to force gh's own auth.

---

## Batch Processing

When multiple comments exist, batch related fixes:

```bash
# Group by file (includes CodeRabbit, Copilot, and github-actions bot)
gh api "repos/${REPO}/pulls/${PR_NUM}/comments" \
  --jq '.[] | select(.user.login | test("coderabbit|copilot|github-actions"; "i")) | .path' \
  | sort | uniq -c | sort -rn
```text

Vercel Toolbar threads group naturally by page/route (the `path` field on each thread) — fix all threads on one page together before moving to the next, and watch for duplicates (two threads pointing at the same underlying root cause, e.g. two dark-mode-illegible reports on the same chart) so you fix once and reply/resolve both.

Address all issues in a single file together, then commit:

```bash
git add <file>
git commit -m "fix: Address review feedback in <file>

- Fixed issue 1
- Fixed issue 2

Addresses CodeRabbit/Copilot/Claude comments"
```

---

## Integration with Other Skills

### Use watch-pr for continuous monitoring

`address-feedback` is a **one-shot** pass. When you want to watch a PR until all comments are resolved and CI is green across multiple iterations, use `watch-pr` instead:

```text
> watch this PR
```

`watch-pr` is the autonomous loop: it polls reviewers after every push and, for each new thread, delegates back to this skill's triage — driving to a merge-eligible exit gate (0 unresolved threads + CI green). `address-feedback` is for a single explicit addressing pass without the loop.

### Do useful work while waiting for CI

When CI is running after a push, don't idle. Use the time to:
- Update skill files or documentation
- Address other pending PR feedback in other branches
- Answer user questions, update memory

### Chain with telemetry-judge (Optional Quality Check)

After addressing automated feedback, optionally validate with the judge skill for deeper quality review:

```text
> address feedback
> [after fixes] /judge this implementation
```

The judge skill (`telemetry-judge`) provides adversarial quality evaluation for your own code—it's a different workflow than addressing PR comments.

### Chain with pr-fix-branch

If reviewing someone else's PR:

```text
> fix PR #123 - address the coderabbit feedback
```

### Defer to repo-specific skills when one exists

If a repo has its own project skill that already documents Vercel Toolbar conventions (team/project IDs, PR body format, a "Reviewer focus" requirement, etc.), follow that skill's specifics — this skill provides the general mechanism (fetch → triage → fix → reply → resolve → collate), a repo skill may pin down exact IDs, naming, or additional required PR sections on top of it.

---

## Timing Notes

- **CodeRabbit**: Reviews appear 5-15 minutes after PR creation/update
- **Copilot**: Reviews appear 2-5 minutes after PR creation/update
- **Claude Code Action**: Reviews appear 2-10 minutes after PR creation/update (depends on workflow trigger)
- **Vercel Toolbar**: Not review-latency-based — comments appear the moment a human clicks the preview and types. New threads can (and will) arrive mid-session, including while you're still fixing an earlier round. Re-poll `list_toolbar_threads` after every push/deploy rather than assuming one fetch caught everything, and check again whenever the user says something like "there's more" or "more threads."

If GitHub-native comments haven't appeared yet, wait and re-check:

```bash
# Check if review is pending
gh api "repos/${REPO}/pulls/${PR_NUM}/reviews" --jq 'length'
```text

A failing `Vercel Preview Comments` CI check (if present) usually means unresolved Toolbar threads exist — re-run `list_toolbar_threads({status: "unresolved"})` rather than assuming it's a real CI failure.

---

## Best Practices

1. **Address in priority order** - Security > Correctness > Quality > Style (GitHub-native sources); Bug vs Feature-request (Vercel Toolbar)
2. **Batch related fixes** - Group by file, logical area, or (for Vercel) by page/route
3. **Always reply** - Close the feedback loop for tracking; for Vercel, reply on the thread AND keep the collated GitHub comment current
4. **Test after fixing** - Don't create new bugs while fixing old ones
5. **Push incrementally** - Smaller pushes = faster re-review
6. **Don't dismiss valid feedback** - If you disagree, explain why in reply
7. **Never scope-creep on Vercel feature requests** - defer to Follow-up, don't silently expand the PR
8. **Watch for concurrent agents on the same branch** - if another background agent or session is also working the same PR/thread set, a divergent unpushed commit can appear on the same branch in a different worktree. Don't force-push over it; verify with `git log <local>..<remote>` / `<remote>..<local>` and reconcile (usually: confirm your side is a superset, then fast-forward or merge) before continuing.
