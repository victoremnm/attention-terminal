## User Impact Summary
Users can now browse curated Hugging Face models under a new "Models" surface tab, with a sortable leaderboard, 1h trending velocity, charts, and a detail drawer.

## PR Summary
- **`app/models/page.tsx`** — new `/models` route; server fetches 8 query functions, renders `<ModelsSurface>`
- **`app/api/models/route.ts`** — GET with `sort` / `limit` query params
- **`app/api/models/[modelId]/route.ts`** — GET model detail + scan history
- **`src/components/ModelsSurface.tsx`** — new surface component: StatsCards, trending list, sortable leaderboard, pipeline PieChart, library HorizontalBarChart, author leaderboard, scan-kind grid, and detail drawer with Sparkline
- **`src/components/ModelsSurface.test.tsx`** — 8 tests covering all prop shapes and edge cases
- **`src/components/SurfaceNav.tsx`** — reordered: Models tab inserted between Events and Trending
- **`src/lib/queries/huggingface.ts`** — added `created_at` + `tags` to query output, exported `HfModelDetail` type
- **`app/globals.css`** — appended `models-*` CSS classes (stats cards, leaderboard, drawer, charts row, scan grid)

## What was verified (by the agent)
- `npx tsc --noEmit` — zero errors
- `npx vitest run` — 472 passed (up from 464), 54 test files, 3 skipped
- All 8 new ModelsSurface tests pass
- Existing huggingface query tests (19) and dependency tests continue green

## What needs human verification
- Visual: /models page renders stats cards, trending, leaderboard, charts, scan grid — reload-from-scratch
- Drawer: click a leaderboard row to open side panel; verify detail, tags, Sparkline, and Close/ESC
- Sort: toggle downloads / likes / newest on the leaderboard
- Private/gated models show with badges (amber "gated", magenta "private")

## Graceful degradation
- Empty model list shows "No models loaded yet. The HF ingestion cron runs every hour."
- Missing headline hides StatsCards section
- Missing trending hides trending section
- Missing pipeline tags / libraries / authors / scan kinds hides respective charts
- Drawer shows loading state while fetching, error state on failure
- Detail drawer fully keyboard-accessible (ESC to close)

## Agent attribution
- **Agent ID**: opencode-task-explore (ModelsSurface impl via Task tool)
- **Model**: deepseek-v4-flash-free
- **Agent type**: coder
- **Session**: opencode-session-20260726

## Notes for review
- 8 new files; no changes to main except SurfaceNav gitignore and CSS append
- No migrations or config changes needed
