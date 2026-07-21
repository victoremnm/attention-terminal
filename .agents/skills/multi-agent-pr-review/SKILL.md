---
name: multi-agent-pr-review
description: Orchestrate multi-agent PR work — decompose into issues, execute with cheaper subagents in isolated worktrees, review + validate with a stronger model, and merge only behind a hard gate (CI green AND zero unresolved review threads). USE WHEN a task spans several independent changes, when running "issues → subagents → review → merge" loops, or when coordinating parallel agents on one repo.
version: 1.0.0
---

# Multi-Agent PR Review

A repeatable loop for shipping several changes with subagents while keeping a human-quality bar. Pairs with `address-feedback` (which handles the comment-resolution mechanics) and `watch-pr` (which watches a single PR to its merge gate).

## The loop

1. **Decompose → issues.** Turn the work into separate, well-scoped GitHub issues, each with: problem, evidence, scope (exact files), acceptance criteria, and conventions (branch+PR, commit style, the merge gate). One concern per issue.
2. **Execute with cheap subagents.** Spawn one subagent per issue (e.g. Sonnet), each in an **isolated worktree**. They implement, typecheck, open a PR (`Closes #NN`), and **never self-merge**. Different files → run in parallel; same file → sequence them (or one agent) to avoid conflicts.
3. **Review with a stronger model (don't trust self-reports).** Read the actual diff, not the subagent's summary. **Independently validate claims** — especially run any SQL/queries against the real system rather than accepting "reasoned through / couldn't run it here." Subagents also get repo identity wrong (local dir name ≠ git remote) and can work in stray clones — verify the PR is against the right repo/base.
4. **Merge gate (hard).** Merge only when **CI is green AND unresolved review threads == 0**. Protected branches with "require conversation resolution" block otherwise. Automated reviewers (Codex, CodeRabbit, Copilot) **re-review after every push**, so poll and re-check threads after each round — you are not done until a fresh check is still zero.
5. **Address findings, loop.** Hand a PR's review findings back to its subagent (resume it with the thread list) or fix inline; then reply + **resolve** each thread (see `address-feedback`) and re-run the gate. Automated findings are usually legitimate — fix them, don't dismiss.

## Disciplines that matter

- **Reviewer validates independently.** The single biggest quality lever — a subagent that says "the query is correct" is a hypothesis; running it is the test.
- **Subagents implement, the orchestrator merges.** Keeps the gate in one place.
- **Worktree isolation for parallel file-mutating work**; it prevents branch/worktree collisions.
- **`env -u GITHUB_TOKEN gh …`** if the repo's `.env` exports a `GITHUB_TOKEN` (it shadows gh's auth → 401).
- **Log dropped scope.** If you cap, sample, or defer, say so; silent truncation reads as "covered everything."

## Not this skill

Single-PR comment resolution mechanics (fetch/reply/resolve/poll-to-zero) live in `address-feedback`. Autonomous single-PR CI+review watching lives in `watch-pr`. Idle-time backlog pickup with cheap subagents lives in `idle-pickup`. This skill is the fan-out/decompose-and-orchestrate layer above them.
