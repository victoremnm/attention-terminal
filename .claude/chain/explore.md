# Exploration synthesis

Session: `orch-repo-drilldown-20260722`

Five read-only explorers completed and were logged to `subagent_runs`.

## Evidence

- `repoDrilldown()` launches 14 reads. Safe first reduction: approximately 9–10 reads by sharing the request high-water mark, table-existence checks, hourly rows, releases, and bounded commit data.
- PR/issue pulse counts include all currently open records, so a 30-day activity rowset cannot replace the unbounded open-state scan without changing semantics.
- Drilldown and REST tables already lead with `repo_name`; no authoritative numeric GitHub repository ID exists in this codebase. Do not add Bloom filters or hash-only keys without `EXPLAIN indexes = 1` and `system.query_log` evidence.
- Daily Skinny uses duplicated first-match substring rules and explicitly matches the project’s own `attention`/`terminal` repositories. A versioned topic taxonomy with aliases, exclusions, and stable IDs is needed.
- The drilldown UX has overlapping 24-hour and 7-day contributor surfaces. A cumulative 7-day chart, ranked clickable identities, consistent time anchoring, and optional lazy code frequency are the coherent direction.
- Telemetry is automatic only for Trigger worker runs. Script logging is manual; token/cost estimates lack provenance; failed ClickHouse inserts can be lost when credentials are configured.

## Cross-cutting risks

- Preserve `FINAL` where ReplacingMergeTree correctness requires it; benchmark rather than remove it speculatively.
- Resolve the `gh_repo_activity_feed` view/table migration name collision before relying on that object.
- Keep optional enrichments fail-open and status-aware.
- Native numeric payloads should remain numeric through SQL, shaping, and rendering; convert only at the presentation boundary.
