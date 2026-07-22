## User Impact Summary

What does a user see differently after this PR merges? One sentence — the observable change from their seat, not the implementation. If this is an internal/infra change with no user-facing surface, say so explicitly ("internal: no user-facing change").

## PR Summary

Bullet list of what changed. Concrete: file paths, table names, RPC signatures. A reader who has never seen this repo should be able to understand the scope from this list alone.

Closes #N (if applicable).

## Review at a glance

Preview/evidence link: [live preview URL or committed artifact]

### Before / after proof

- Before: [what was broken or missing]
- After: [what the reviewer can now observe]
- Evidence: [embedded screenshot, HTML preview, rendered query result, or build proof]

## What was verified (by the agent)

What the agent actually ran and observed — not what it intended. Each bullet is a command + observed result. If the agent did NOT verify something, that fact appears here too.

- `npx tsc --noEmit` — passes clean (0 errors)
- `npx tsx scripts/smoke-*.mjs` — observed: [real numbers/results]
- `./scripts/migrate.sh status` — [applied/pending state]
- CI: [which checks passed/failed]

## What needs human verification

What a human must check that the agent cannot. Be specific — name the UI element, the interaction, the visual property. If nothing needs human verification, say "nothing — agent-verified end to end" (rare; only for pure infra/SQL changes with no UI surface).

- [ ] UI visual check: [what to look at, what to look for]
- [ ] Interaction test: [what to click/ask, what should happen]
- [ ] Model/external service test: [what to run, what to verify]

## Graceful degradation

If this PR adds new optional fields/tables/endpoints, how does the system behave when they're absent or empty? If not applicable, say "n/a — no new optional surfaces".

## Notes for review

Context the reviewer needs that isn't in the bullets above: merge conflicts resolved, pre-existing bugs fixed along the way, env vars added, anything that might surprise a reviewer.
