# Agent conventions (Attention Terminal)

These conventions apply to every agent working on this repo. They are
load-bearing — agents that skip them produce unreviewable PRs and
uninstrumented work.

## Subagent telemetry (mandatory)

Every subagent run (Task tool, explore agent, general agent, any spawned
sub-agent) must be logged to `subagent_runs` in ClickHouse so the
`subagent_experiments` view picks it up. This is how we compare models
(glm-5.2 vs gpt-5.1 vs others) on the same specs.

**How to log**: call the helper script after each subagent completes:

```bash
./scripts/log-subagent-run.sh \
  --session-id "<session-id>" \
  --prompt-id "<unique-run-id>" \
  --agent-id "<agent-id>" \
  --agent-type "<explore|general|coder|...>" \
  --model "<model-name>" \
  --spec "<the spec/prompt given to the subagent>" \
  --result "<the result returned>" \
  --latency-ms <ms> \
  --ok <0|1>
```

The script reads ClickHouse creds from `.env` (same as `migrate.sh`) and
inserts a row into `subagent_runs`. It always exits 0 — telemetry must
never fail a turn.

If `CLICKHOUSE_URL` is unset, the script spools to
`~/.claude/telemetry/spool.ndjson` for later backfill (never loses data).

**What to log**:
- `spec_hash` — stable hash of the spec (same spec + different models =
  comparable rows). The script hashes the `--spec` arg.
- `model` — the model that ran the subagent (e.g. `glm-5.2:cloud`,
  `openai:gpt-5.1`). For opencode Task tool runs, use the model ID from
  the system prompt.
- `latency_ms` — wall-clock from spawn to completion.
- `ok` — 1 if the subagent returned a useful result, 0 if it errored or
  returned empty.
- `result_preview` — first 300 chars of the result (for quick scanning
  in the experiments view).

**Comparison query** (docs/model-comparison.md):
```sql
SELECT model_name, count() AS runs, avg(latency_ms) AS avg_latency,
       avg(total_cost_usd) AS avg_cost, avg(eval_score) AS avg_score
FROM subagent_experiments
WHERE agent_type = 'explore'  -- or whatever agent type
GROUP BY model_name
ORDER BY runs DESC
```

## Issue claiming and Model Tagging (mandatory)

1. **Issue Claiming**: When an agent begins work on an issue (or calls dibs), it must immediately assign the maintainer (`victoremnm`) to the issue via `gh issue edit <issue_number> --add-assignee victoremnm` to indicate that it is claimed and avoid redundant work across agents.
2. **Model Tagging & GitHub Labels**: Every PR authored by an agent must apply a GitHub label matching the high-level LLM model family (e.g. `Gemini`, `DeepSeek`, `Codex`, `Claude`, `Qwen`, `GLM`) via `gh pr edit <pr_num> --add-label "<ModelFamily>"`. Additionally, the PR body, review comments, and commit trailers must state `Model: <ModelFamily>` with specific model details (e.g. `Model: Gemini 3.6 Flash`, `Model: DeepSeek V3`, `Model: Codex (gpt-5.5)`). High-level family names are used for GitHub labels, while granular model details are recorded in the PR text.

## PR template (mandatory)

Every PR must follow `.github/PULL_REQUEST_TEMPLATE.md`. The key sections:

1. **User Impact Summary** — one sentence, observable change from the
   user's seat.
2. **PR Summary** — bullet list of what changed (file paths, table names).
3. **What was verified (by the agent)** — commands + observed results.
   If the agent did NOT verify something, that fact appears here.
4. **What needs human verification** — specific UI elements, interactions,
   or external services a human must check. If nothing needs human
   verification, say "nothing — agent-verified end to end".
5. **Graceful degradation** — how the system behaves when new optional
   surfaces are absent or empty.
6. **Agent attribution** — identify the agent that authored the PR
   (model ID or human name) and the count of subagent runs logged.
7. **Notes for review** — merge conflicts resolved, pre-existing bugs
   fixed, env vars added, anything surprising.

## Review evidence (mandatory)

Every implementation PR must be reviewable from the PR page without asking a
human to reconstruct the work from raw commits. The PR body must include a
short `Review at a glance` section with:

1. **Preview** — for user-visible work, a current Vercel preview URL plus an
   attached screenshot or committed HTML/image artifact. Store committed
   evidence under `docs/pr-evidence/<pr-number>/` and embed or link it from
   the PR body. Prefer an image embed pinned to the evidence commit, for
   example:
   `![Preview](https://raw.githubusercontent.com/victoremnm/attention-terminal/<commit>/docs/pr-evidence/<pr-number>/preview.png)`.
   A local-only screenshot is not an attachment and must be labeled as
   local-only.
2. **Before/after proof** — one or two concrete observations showing what
   changed and how the reviewer can reproduce it.
3. **Verification status** — exact commands and CI/deployment results, with
   unverified items explicitly called out.
4. **Human checklist** — no more than the specific interactions that still
   require a human; do not make the reviewer infer these from the diff.

For non-visual SQL, schema, documentation, or dependency PRs, provide a
rendered query result, generated documentation preview, dependency/build
proof, or another directly inspectable artifact instead of inventing a UI
screenshot. Agents must update the PR body after capturing evidence and must
not claim an artifact is attached unless the link works from the PR page.

## Agent identity and review status (mandatory)

Every implementation or review agent must identify itself in the PR body or
review comment with:

- `Agent ID`: orchestrator/subagent ID
- `Model`: model identifier used for the run
- `Agent type`: explorer, reviewer, coder, or other role
- `Session`: telemetry session ID
- `Scope`: files, issue, or PR reviewed

Every PR authored by Codex or an agent must also carry the repository's
`codex` label. Apply it after creating or locating the PR:

```bash
gh pr edit <PR_NUM> --repo victoremnm/attention-terminal --add-label codex
```

If the label is unavailable, report that explicitly in the PR notes instead
of silently omitting the attribution.

An independent reviewer may add the `lgtm` label only when the PR has current
evidence, green CI, and no unresolved actionable review comments. The
implementation agent must never apply `lgtm` to its own PR. If any blocking
correctness, security, performance, evidence, or verification issue remains,
the reviewer must add the `blocked` label and explain the blocker in a PR
comment. These labels are review signals, not merge approval; the human merge
gate still applies.

### Commit message convention (mandatory)

Every commit authored by an agent must include a `Co-authored-by:` trailer
identifying the agent. This is for traceability — when reviewing a PR, the
reviewer needs to know who/what wrote each commit.

Format:
```
<type>: <description>

Co-authored-by: <model-id> <agent@attention-terminal>
```

Example:
```
feat: add Octokit activity client

Co-authored-by: glm-5.2:cloud <agent@attention-terminal>
```

If a human authored a commit, no trailer is needed. If multiple agents
worked on the PR, each agent's commits carry their own trailer.

Agents must not self-merge. A human reviews and merges after the human
verification checklist is satisfied.

## CI polling (mandatory)

After pushing, the agent must poll the PR's CI checks until all are
complete before the PR can be merged. Poll every 30 seconds, maximum 10
iterations (5 minutes). If checks are still pending after 10 iterations,
report the status and stop — let the user request more checks.

```bash
# Poll CI until all checks complete
for i in $(seq 1 10); do
  sleep 30
  PENDING=$(gh pr view <PR_NUM> --repo <REPO> --json statusCheckRollup \
    --jq '[.statusCheckRollup[]? | select(.name != null) | select(.conclusion == null or .conclusion == "")] | length')
  echo "Poll $i: $PENDING pending checks"
  if [ "$PENDING" = "0" ]; then
    echo "All CI checks complete"
    gh pr view <PR_NUM> --repo <REPO> --json statusCheckRollup \
      --jq '[.statusCheckRollup[]? | select(.name != null) | "\(.name): \(.conclusion)"] | .[]'
    break
  fi
done
```

Only after CI is green AND all review comments are addressed (fixed +
replied to) should the agent ask the human to approve + merge.

## Review comments (mandatory)

All automated review comments (CodeRabbit, Copilot, Codex, Claude Code
Action) must be resolved before a PR can be merged:

1. **Fix** — apply the fix if relevant and improving
2. **Reply** — post an inline reply to the comment thread explaining what
   was changed and the commit SHA: `Fixed in <sha>\n\n<explanation>`
3. **Defer** — if the feedback is valid but out of scope, create a new
   issue and reply with `Deferred to #N — <reason>`
4. **Close** — if the feedback is irrelevant, reply with `Not applicable
   — <reason>` and dismiss

Never leave a review comment unreplied. The PR cannot merge with open
threads.

## Worktrees (mandatory)

Every agent works in a worktree, never directly on `main`. Create one
before starting work:

```bash
git worktree add .claude/worktrees/agent-<task-name> feat/<branch-name>
```

This keeps `main` checkout clean and allows multiple agents to work in
parallel without colliding.

## Migrations (mandatory)

All ClickHouse DDL goes through goose — `migrations/` +
`./scripts/migrate.sh up|status`. Never ad-hoc DDL. New MVs need a manual
`INSERT INTO ... SELECT` backfill (MVs only see post-creation inserts).

## Secrets (mandatory)

Secrets come from 1Password Personal vault → `.env` (gitignored). Never
inline. ClickHouse creds in item `4innzk6cud7bz5v562i7tpgpki`, Trigger.dev
in `2pgjlwxybaqvtrxjvlor5dkrsm`, OpenAI in `mfxzvdmx24qw74iue377jcflte`.
`GITHUB_TOKEN` must be set in both the Next.js env and each Trigger.dev
environment.

## Pre-push telemetry (mandatory)

Before every `git push`, the agent must report the current session's
subagent activity to the PR as a comment. This makes every push traceable
to the agent runs that produced it — run IDs, tokens used, model, latency.

**How to report**: call the helper script before pushing:

```bash
./scripts/pre-push-telemetry.sh <PR_NUM> [session-id]
```

The script:
1. Queries `subagent_runs` in ClickHouse for the current session
2. Aggregates token counts, run counts, success rate
3. Posts a telemetry table as a PR comment with the commit SHA

If no subagent runs are found for the session, the script exits silently
(non-blocking). Always exits 0 — telemetry must never block a push.

**Convention**: set `ATTENTION_SESSION_ID` in the environment so all runs
in a session share the same session ID. The pre-push script uses this to
group runs. If unset, defaults to `opencode-session-YYYYMMDD`.

## CI polling (mandatory)

After pushing, the agent must poll the PR's CI checks until all are
complete before the PR can be merged. Poll every 30 seconds, maximum 10
iterations (5 minutes). If checks are still pending after 10 iterations,
report the status and stop — let the user request more checks.

```bash
for i in $(seq 1 10); do
  sleep 30
  PENDING=$(gh pr view <PR_NUM> --repo <REPO> --json statusCheckRollup \
    --jq '[.statusCheckRollup[]? | select(.name != null) | select(.conclusion == null or .conclusion == "")] | length')
  echo "Poll $i: $PENDING pending checks"
  if [ "$PENDING" = "0" ]; then
    echo "All CI checks complete"
    gh pr view <PR_NUM> --repo <REPO> --json statusCheckRollup \
      --jq '[.statusCheckRollup[]? | select(.name != null) | "\(.name): \(.conclusion)"] | .[]'
    break
  fi
done
```

Only after CI is green AND all review comments are addressed should the
agent ask the human to approve + merge.

## Review comments (mandatory)

All automated review comments (CodeRabbit, Copilot, Codex, Claude Code
Action) must be resolved before a PR can be merged:

1. **Fix** — apply the fix if relevant and improving
2. **Reply** — post an inline reply to the comment thread with the commit
   SHA: `Fixed in <sha>\n\n<explanation>`
3. **Defer** — if valid but out of scope, create a new issue and reply:
   `Deferred to #N — <reason>`
4. **Close** — if irrelevant, reply: `Not applicable — <reason>`

Never leave a review comment unreplied.

## Handling Blocked PRs (mandatory)

The `blocked` GitHub label signals a PR has issues preventing merge, but agents must NOT wait for the label — they must proactively detect issues on ALL open PRs.

**Detection**: Every session start and after every push, scan all open PRs for blocking conditions:

```bash
gh pr list --repo victoremnm/attention-terminal --state open --json number,title,mergeStateStatus,mergeable,labels \
  --jq '.[] | select(.mergeStateStatus != "CLEAN" or .mergeable == "CONFLICTING") | "PR #\(.number): \(.mergeStateStatus) \(.mergeable) \([.labels[].name] | join(","))"'
```

**Blocking conditions** (check ALL, not just those with a `blocked` label):
- `mergeable == "CONFLICTING"` — merge conflict with main
- `mergeStateStatus == "DIRTY"` or `"UNSTABLE"` — CI failures or pending
- `mergeStateStatus == "BLOCKED"` — review required or branch behind base
- Open review threads (`.reviewThreads[].isResolved == false`) — includes automated reviews (Codex, CodeRabbit, Copilot, Claude)
- `CHANGES_REQUESTED` reviews on the PR
- A `blocked` label applied manually by a human

**Resolution workflow**:
1. **Merge conflicts**: Fetch `origin/main`, merge into worktree branch, resolve `<<<<<` markers, commit, push.
2. **Review comments**: Fix code, reply with `Fixed in <sha>`, resolve review threads via GraphQL using the THREAD's node ID (not the comment's node ID):
   ```bash
   # Find unresolved threads
   gh api graphql -f query='
   query { repository(owner:"victoremnm",name:"attention-terminal") {
     pullRequest(number:<PR>) { reviewThreads(first:10) {
       nodes { id isResolved comments(first:5) { nodes { id body(limit:80) } } }
     } }
   } }'
   # Resolve each unresolved thread
   gh api graphql -f query='
   mutation { resolveReviewThread(input:{threadId:"<THREAD_ID>"}) { thread { isResolved } } }'
   ```
3. **Failing CI**: Read logs from `statusCheckRollup[].detailsUrl`, fix root cause, verify locally, push.
4. **Branch behind base**: Merge `origin/main` into the worktree branch.
5. **Unblock**: Remove `blocked` label (`gh pr edit <PR_NUM> --remove-label blocked`) and log subagent telemetry only when ALL blockers are resolved AND CI is green.

## Skills mount (recommended)

This repo's custom skills can be mounted with:

```bash
npx skills add victoremnm/skills
```

This installs the repo-scoped skills (address-feedback, agent-chain,
background-runner, ci-check, multi-agent-pr-review, watch-pr, etc.) so
agents have the right workflows for CI polling, review addressing, and
multi-agent orchestration.
