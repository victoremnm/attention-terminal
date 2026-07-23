---
name: idle-pickup
description: When idle, spawn cheap subagents (Haiku, escalating to Sonnet) to pick up ready-labeled open issues and review still-open PRs in the current repo, producing gated draft PRs and review suggestions for a human to approve. USE WHEN user says "pick up open work", "work the backlog", "review open PRs", "use idle time", "spawn cheap agents on issues", OR another skill (e.g. watch-pr) has idle wait time and wants the backlog worked with cheap models.
version: 1.0.0
---

# Idle Pickup

Turn otherwise-wasted idle time into progress: dispatch **cheap subagents** at the current repo's backlog — open issues that are ready, and open PRs that need a review — and bring back **gated proposals**, never merged changes. Runs standalone ("pick up open work") or is invoked by another skill during its waits (e.g. `watch-pr` between reviewer rounds).

The unit of value is a **draft**: a draft PR for an issue, or review suggestions on an open PR. A human (or the main agent) approves before anything ships.

## Hard Rules

1. **Gated output only.** A subagent may branch, commit, and open a **draft** PR, or post review comments as **suggestions** — nothing more. Never mark a PR ready, never merge, never push to `main`, never resolve someone else's review thread.
2. **Cheap by default.** Spawn subagents at **Haiku**. Escalate a single item to **Sonnet** only after Haiku stalls or returns low-confidence on it. Never reach for Opus here — this skill exists to offload work *off* the expensive tier.
3. **Ready work only.** Pick up an issue only if it carries the configured ready label (default `ready-for-agent`) and is unassigned. Review an open PR only if it is not a draft and not already reviewed this session. Skip anything ambiguous rather than guessing scope.
4. **Idle means idle.** Yield immediately when the caller needs the turn back (e.g. `watch-pr`'s next round is ready). Idle work is preemptible; never let it delay the primary task.
5. **Bounded fan-out.** Default cap of 3 concurrent subagents. Each subagent gets one item. Stop dispatching when the ready backlog is empty or the caller reclaims the turn.

## Selecting Work

Scope is the **current repo only** unless the user names others. Two queues:

```bash
# Ready issues: labeled + unassigned + open
env -u GITHUB_TOKEN gh issue list --state open --label ready-for-agent \
  --json number,title,assignees --jq '.[] | select(.assignees|length==0) | {number,title}'

# Open PRs needing review: not draft, open
env -u GITHUB_TOKEN gh pr list --state open --draft=false \
  --json number,title,reviewDecision --jq '.[] | {number,title,reviewDecision}'
```

Present the picked queue before dispatching so the user can veto items. When called by another skill mid-wait, skip the prompt and dispatch the top items up to the fan-out cap.

## Dispatching Subagents

One subagent per item, at Haiku, each with a **self-contained** brief — the subagent has none of this conversation's context.

### Issue → draft PR

Brief the subagent to:
1. **Claim the issue**: Immediately assign the maintainer (`victoremnm`) via `gh issue edit <n> --add-assignee victoremnm` to signal that it is claimed.
2. **Implement fix**: Read the issue, explore the repo, make minimal changes, branch as `fix/issue-<n>`, commit with model trailer (`Co-authored-by: <model-id> <agent@attention-terminal>`), and open a **draft** PR linking the issue (`Closes #<n>`).
3. **Tag Model & Label**: Apply the high-level model family GitHub label via `gh pr edit <n> --add-label "<ModelFamily>"` (e.g. `Gemini`, `Codex`, `DeepSeek`, `Claude`, `Qwen`, `GLM`) and specify detailed model info in the PR title/body (e.g. `Model: Gemini 3.6 Flash`).
4. **Report back**: Report branch name, PR number, model name, one-line summary, and confidence level.

### Open PR → review suggestions

Brief the subagent to: read the diff, check correctness/security/tests against repo conventions, tag the LLM model family (`Model: Gemini`, `Model: DeepSeek`, `Model: Codex`, etc.), and post findings as PR **review comments phrased as suggestions** — not approvals, not resolutions. It reports the count and severity of findings.

## Collecting Results

Gather each subagent's structured report and present a single roll-up:

| Item | Subagent | Model | Result | Needs review |
|---|---|---|---|---|
| issue #42 | fix/issue-42 | Haiku | draft PR #58 | yes |
| PR #17 | review | Haiku | 3 suggestions (1 correctness) | yes |
| issue #51 | — | Haiku→Sonnet | no PR: scope unclear | escalate to user |

Everything in the roll-up is a **proposal awaiting a human gate**. Do not represent a draft PR or a suggestion as done work.

## Model Note

Subagents here use the Claude family via the harness's agent mechanism — **Haiku** (cheap default) and **Sonnet** (escalation). True external **OSS models** (Llama, Qwen, etc.) are **not** directly spawnable as subagents; wiring them in requires an out-of-band runner (an MCP server or CLI) the user provides. Absent that, "cheap" means Haiku.
