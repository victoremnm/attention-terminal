---
name: agent-chain
description: Break complex work into staged explore, plan, and implement phases with explicit handoff artifacts. Use when a task is multi-step, benefits from sequencing, or needs a clear artifact between stages.
---

# Agent Chain

Use this when one agent should not carry the whole task context.

## Workflow

1. Create a small chain workspace such as `.claude/chain/`.
2. Write exploration findings to `explore.md`.
3. Write the implementation approach to `plan.md`.
4. Execute against `plan.md` and record outcome in `result.md`.
5. Run validation before closing the chain.

## Good Fits

- investigate -> plan -> implement
- refactors with multiple moving parts
- bugs where diagnosis and fix should stay separate
- work that benefits from resumable artifacts

## Minimal Artifacts

- `explore.md`: facts, code locations, hypotheses
- `plan.md`: chosen approach, risks, test plan
- `result.md`: changes made, validation, follow-ups

## Rules

- Keep each artifact short and factual.
- Do not repeat the full task in every file.
- If exploration is uncertain, stop the chain before implementation.
- If the task is small, skip the chain and just do the work.
