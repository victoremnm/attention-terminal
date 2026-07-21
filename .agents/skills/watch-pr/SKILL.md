---
name: watch-pr
description: Autonomously watch a pull request after it opens, polling for reviewer feedback (Codex, Copilot, CodeRabbit, Claude Code Action, human reviewers) and driving every thread to resolved without a human re-invoking each round. USE WHEN user says "watch this PR", "watch the PR", "poll for feedback", "wait for reviews", "keep addressing feedback until done", OR an agent has just opened a PR and should loop on review feedback until the PR is merge-eligible.
version: 1.0.0
---

# Watch PR

An autonomous **watch loop** around a single PR: wait for reviewers, address each new thread, push, and re-poll until the PR is **merge-eligible** (zero unresolved threads, CI green). This skill owns only the *lifecycle* — the cadence, quiescence detection, and exit gate. It **delegates every per-comment decision to `address-feedback`**, which is the single source of truth for triage, fixing, replying, and resolving.

Use `address-feedback` directly for a one-shot pass a human drives. Use `watch-pr` when the PR should be watched to completion hands-off.

## Hard Rules

1. **Delegate triage — never restate it.** For each new thread, apply `address-feedback`'s three-outcome triage (Acknowledged → fix; Irrelevant → reply + resolve; Relevant-but-out-of-scope → issue + link + resolve). Do not duplicate those rules here; if triage behavior must change, change it in `address-feedback`.
2. **Bounded polling.** Poll at most every 3 minutes, and cap the run (default 10 reviewer rounds). Never spin a tight/unbounded loop. On reaching the cap, stop and hand back a status summary — do not keep going silently.
3. **Human comments checkpoint before dismissal.** A fix that clearly addresses a human's comment may be replied-to and resolved autonomously. But **Irrelevant** (close) or **Relevant-but-out-of-scope** (defer) on a *human* comment must be surfaced to the user for confirmation before resolving — never unilaterally dismiss a person's comment. Bot comments (Codex/Copilot/CodeRabbit/Claude) take the full autonomous triage.
4. **Never push to main; never merge.** Work lands on the PR branch only. Reaching the exit gate makes the PR merge-*eligible*; the actual merge is the user's call.

## The Loop

Each pass through the loop is one **reviewer round**.

### 1. Anchor the PR

Resolve the PR number and repo (reuse `address-feedback` Phase 1). If invoked right after `gh pr create`, use that PR. If none exists, ask which PR to watch — do not guess.

### 2. Wait for reviewers to weigh in on the latest commit

Reviewers re-review **after every push** and post asynchronously (Copilot ~2–5 min, CodeRabbit ~5–15 min, Claude Code Action ~2–10 min; humans whenever). Wait on a cadence rather than fetching once:

- **Claude Code:** a `Monitor` on `gh pr checks` plus a re-fetch of review threads after each round is the intended shape; `ScheduleWakeup` (or `/loop`) paces the gap between rounds. Do useful work in the gap — see *Idle time* below.
- **Portable:** any harness — sleep-poll on an interval bounded by Rule 2.

The round is **quiescent** when a full poll interval passes after the latest push with no new threads *and* no reviewer check still running. Only a quiescent round is safe to triage as "complete for this commit."

### 3. Fetch the fresh threads and triage each

Re-fetch unresolved review threads (the GraphQL query in `address-feedback` Phase 6). For each **new** thread, hand off to `address-feedback` — with the human-comment checkpoint from Rule 3. Batch fixes by file; commit and push once per round so re-review is fast.

### 4. Re-poll

After the push, return to step 2. New comments can arrive in response to your fixes — a round that surfaces new threads resets quiescence.

## Idle Time — Don't Waste the Wait

The 2–15 minute gaps between reviewer rounds are real idle time. During a wait, invoke [`idle-pickup`](../idle-pickup/SKILL.md) to spawn cheap subagents against the backlog (ready-labeled issues, other open PRs) while this PR's reviewers catch up. Yield back to the watch loop the moment the next round is ready.

## Exit Gate (hard — do not report done until both hold)

Re-verify **after the final push**:

1. **Unresolved review threads == 0** (GraphQL count from `address-feedback` Phase 6), and
2. Required CI checks are green.

Report the final unresolved count and CI state explicitly. If a new comment arrives after you believe you're done, **you are not done** — loop again. If the round cap is hit before the gate is met, stop and report exactly what remains open (which threads, which checks) so the user can decide.

## Env caveat

If `GITHUB_TOKEN` is exported in your shell, `gh` can fail with `401 Bad credentials`. Run `gh` as `env -u GITHUB_TOKEN gh ...` to force gh's own auth (same as `address-feedback`).
