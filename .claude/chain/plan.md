# Agent pickup plan

## Wave 0 — contracts and evidence

1. **Query consolidation benchmark** — owns #124 and the safe subset of #120. Share high-water/table readiness, merge hourly KPI + velocity, merge releases, and measure old/new payload equality and query-log cost.
2. **ClickHouse identity/index audit** — owns #122. Run live object/cardinality/EXPLAIN checks; keep `repo_name` unless evidence supports a numeric repository dimension or a useful skip index. Resolve the feed object collision as a separate migration concern.
3. **Telemetry provenance gate** — owns #128. Add measured/estimated/unknown provenance and fail-open spooling/CI checks without coupling product queries to live ClickHouse.

## Wave 1 — dependent product surfaces

4. **Seven-day drilldown UX** — owns #115, #117, #123, and #126 after the query contract is stable. Add cumulative 7-day activity, numeric ranked contributors, stable GitHub login links, and richer event attribution.
5. **Daily Skinny taxonomy** — owns #127. Persist canonical topic IDs, source-specific aliases, self-reference exclusions, taxonomy versioning, and an explicit rebuild/backfill.
6. **Code-frequency enrichment** — owns #130. Use a separate cached poller with explicit `202`/stale/unavailable states; render lazily and never block the core drilldown.

## Existing issue links

- Homepage actor leaderboard UI remains #97; indexed actor data is #131 and should consume the contributor contract from #123/#126.
- Surface/routing/navigation work is #105–#113 and is independent of the ClickHouse query wave.
- Missing repository community files are tracked separately from this wave; the reusable issue template was delivered in PR #129.
