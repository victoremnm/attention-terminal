---
name: idle-pickup
description: When idle, spawn cheap subagents (Haiku, escalating to Sonnet) to inspect ready-labeled open issues and review still-open PRs in the current repo, producing gated suggestions for the primary workflow or a human to approve. USE WHEN user says "pick up open work", "work the backlog", "review open PRs", "use idle time", "spawn cheap agents on issues", OR another skill (e.g. watch-pr) has idle wait time and wants the backlog inspected with cheap models.
version: 1.0.0
---

# Idle Pickup

Turn otherwise-wasted idle time into progress: dispatch **cheap subagents** to inspect the current repo's backlog — open issues that are ready, and open PRs that need a review — and bring back **gated suggestions**, never repository or GitHub mutations. Runs standalone ("pick up open work") or is invoked by another skill during its waits (e.g. `watch-pr` between reviewer rounds).

The unit of value is a **suggestion**: a proposed implementation, review finding, or remediation plan. A human or the primary workflow must explicitly approve and execute any mutation.

## Hard Rules

1. **Suggestions-only.** A subagent may inspect issues and PRs and return proposed changes, test plans, or review findings. It must not edit files, create branches or commits, open or update PRs, apply fixes, reply to or resolve/dismiss review threads, mutate another PR, add or remove labels (including `blocked`), mark a PR ready, merge, or push. Route mutations to an explicitly invoked feedback/watch workflow such as `address-feedback` or `watch-pr`, or have the primary workflow perform them after approval.
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

### Issue → implementation suggestion

Brief the subagent to:
1. **Inspect without claiming**: Read the issue, explore the repo, and identify the minimal files, tests, and risks. Do not assign the issue or otherwise change GitHub state.
2. **Return a suggestion**: Report the proposed implementation, validation commands, model, and confidence. Do not edit files, create a branch, commit, or open a PR; the primary workflow must perform those actions after approval.

### Open PR → review suggestions

Brief the subagent to: read the diff, check correctness/security/tests against repo conventions, identify the LLM model family (`Model: Gemini`, `Model: DeepSeek`, `Model: Codex`, etc.) in its report, and return findings as **suggestions** — not PR comments, approvals, or resolutions. It reports the count and severity of findings.

### Blocked PR → suggested remediation

Brief the subagent to:
1. Detect `blocked` label, merge conflicts, failing CI, or unresolved review comments on a PR.
2. Report the exact blockers, affected files, relevant CI or thread URLs, and the safest remediation steps.
3. If useful, provide a patch outline and validation commands, but do not merge `origin/main`, edit code, reply to or resolve review threads, change labels, or clear `blocked`.
4. State that the primary workflow or an explicitly invoked `address-feedback`/`watch-pr` workflow must perform and verify the remediation before any unblock action.

## Collecting Results

Gather each subagent's structured suggestion and present a single roll-up:

| Item | Subagent | Model | Suggestion | Needs review |
|---|---|---|---|---|
| issue #42 | inspect | Haiku | proposed fix and tests | yes |
| PR #17 | review | Haiku | 3 suggestions (1 correctness) | yes |
| issue #51 | — | Haiku→Sonnet | no suggestion: scope unclear | escalate to user |

Everything in the roll-up is a **suggestion awaiting a human gate**. Do not represent a recommendation as implemented, reviewed, resolved, or merged work.

## Model Note

Subagents here use the Claude family via the harness's agent mechanism — **Haiku** (cheap default) and **Sonnet** (escalation). True external **OSS models** (Llama, Qwen, etc.) are **not** directly spawnable as subagents; wiring them in requires an out-of-band runner (an MCP server or CLI) the user provides. Absent that, "cheap" means Haiku.
