---
name: background-runner
description: Run long builds, tests, linters, or verification in the background while continuing implementation work. Use when a command would block progress and does not need active supervision.
---

# Background Runner

Use this for non-interactive commands that may take a while.

## Workflow

1. Start the command in the background.
2. Keep working on non-overlapping tasks.
3. Check status only when needed or when the task completes.
4. Summarize the result and act on failures.

## Good Fits

- test suites
- builds
- lint and typecheck
- packaging
- staging deploys with clear logs

## Heuristics

- Prefer parallel runs for independent checks.
- Avoid background mode for commands that need prompts or stepwise choices.
- If the result blocks the next step, run it in the foreground instead.
