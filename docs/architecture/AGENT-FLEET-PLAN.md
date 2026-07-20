# Attention Terminal — Agent Fleet Plan

> Planning artifact only. No code is written and no agents are spawned by this
> document. It defines **who owns what**, the **contracts between them**, and the
> **order they build in**. Derived from the July 20 product-exploration transcripts
> (`Attention Terminal - Chat Complete`) and the locked decisions below.

**Milestone:** demo-winning slice by **2026-07-23, midnight AoE (~3 days)**.
**Constraint:** the Jul 23 slice must be a *genuine vertical cut of the durable v2
architecture* — the same fleet continues the full backlog afterward, no throwaway.

---

## 1. Locked decisions (the grilling record)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Objective / horizon | **Both** — hero feature by Jul 23, then continue v2 on the same rails. |
| 2 | Hero feature | **Repo-metadata enrichment + metadata-rich tickers + DevScatter.** DevScatter is the *innovative* visual, not decoration. |
| 3 | Form of this deliverable | **Planning doc only** — six charters + boundaries + DAG + sequence. No code, no spawned agents. |
| 4 | Data seam | Warehouse owns schema+contract+read; Acquisition owns fetch+populate. **Seam = schema + insert contract.** |
| 5 | PO vs Architect | Architect (Opus, also reviewer) owns technical DAG + contracts + review gate. PO owns scope + DoD + demo cut. |
| 6 | Design seam | Design owns visual/motion **spec**; Renderer owns **implementation**. **Seam = visual spec + payload schema.** |
| 7 | Sequencing | **Contract-first → parallel (fixtures) → swap live + integrate → review gate → demo.** |
| 8 | Definition of Done | Chat-reachable → live DevScatter answer, deployed (Trigger cloud + Vercel), refresh job live, in the ≤5-min demo video. |

**Cross-cutting theme.** Both seams use the *same* pattern: **a spec/contract owner and
an implementation owner, meeting at a frozen interface.** This is the backbone that keeps
the fleet coherent.

---

## 2. What the transcripts surfaced (the v2 backlog)

The chat was you exercising the live product and, in doing so, exposing the v2 backlog:

1. **Repo metadata is missing** — CH has only event/aggregate stats; every "what is this
   repo about?" answer was *inferred from the repo name*. → `gh_repo_metadata` dimension.
2. **"Cracked humans" is polluted** — bot detection is `[bot]`-pattern only; top human
   pushers are script-spam (`bolividob`, 46k pushes / 1 repo). `commit_count` reads 0 for
   top pushers (suspected metadata bug). → merge-rate / repo-spread / trending cross-ref.
3. **A structured topic vocabulary** — `SkinnyTopic { id, label, kind, sources }`, seeded
   from GH topics + HF tags + a curated dictionary; canonicalizes noisy subject strings.
4. **A visualization library** — existing grammar (Ticker, Digest, Divergence, Candles,
   Matrix) + new: **DevScatter**, comment heat-chips / "comment forest" glyph, stance
   snippets. Stack: **Recharts** default, **ECharts** for dense scatter, **Cytoscape.js**
   for graphs.
5. **Cross-source Attention Graph** (highest innovation) — HN / GitHub / HF layers stitched
   by cross-layer edges (`HN story URL → repo`, `mention → HF model`, `subject → all`).
6. **Sentiment / narrative layer** — stance-tagging on comments + thread-level narrative.

The Jul 23 hero (#1 + the DevScatter half of #4) is deliberately the *foundation* the rest
of the backlog sits on — see §7.

---

## 3. The six roles

| Role | Owns (authority) | Does NOT own | Model |
|------|------------------|--------------|-------|
| **Product Owner** | Scope, priority ordering, acceptance criteria / DoD, judging-criteria alignment, demo narrative + cut decisions. | Technical sequencing, contracts, code. | — |
| **Systems Architect** | Technical dependency DAG; **all interface contracts** (table+insert schema, typed JSON payload, migration protocol); the **go/no-go review gate**. The Opus reviewer. | Scope/priority (PO's), pixel decisions (Design's). | Opus |
| **Data Warehouse** | ClickHouse DDL via goose; `gh_repo_metadata` shape + `_lNd` views; MVs/rollups; the `src/lib/queries.ts` read contract. | The population job; how data is fetched. | Sonnet |
| **Data Acquisition / Integration** | `refreshRepoMetadata` Trigger.dev job; GitHub REST fetch + rate-limit + field mapping; bulk insert into the agreed table. | Table shape, migrations, read layer. | Sonnet |
| **Design** | Visual/motion **spec**: terminal-dark tokens, verdict colors, DevScatter axes/scale/legend/"script-goblins vs builders" read, animation vocabulary, answer-card + ticker layout. | Component implementation. | Sonnet |
| **Visualization Renderer** | React/Recharts/ECharts **implementation** binding the typed payload → pixels, against Design's spec. | Visual decisions, payload shape. | Sonnet |

Model assignment follows the standing preference: **execute with Sonnet, review with Opus**
(the Architect is the reviewer).

---

## 4. The frozen interfaces (Architect freezes these in Phase 0)

Everything parallel in Phase 1 works against these. Changing one is an Architect decision,
broadcast to all affected agents.

### 4.1 Table + insert contract (Warehouse ⇄ Acquisition)

`gh_repo_metadata` — one row per repo, periodically refreshed. **ReplacingMergeTree(fetched_at)
ORDER BY repo_name** (re-insert = correct update, same pattern as `hackernews`).

```
repo_name        String        -- 'owner/name' (dedup key)
owner            String
owner_type       String        -- 'User' | 'Organization'
description      String
language         String        -- primary language
topics           Array(String) -- GitHub topics
homepage         String
license           String        -- SPDX id if present
created_at       DateTime
pushed_at        DateTime
archived         UInt8
fork             UInt8
github_stars     UInt64        -- API count, for cross-check vs activity tables
github_forks     UInt64
open_issues      UInt64
fetched_at       DateTime      -- ReplacingMergeTree version column
```

- **Migration:** goose only, `migrations/2026071900000X_gh_repo_metadata.sql`. Register in
  issue #3. **Never ad-hoc DDL.**
- **Time windows** live on the *activity* side, not here: `_l1d/_l7d/_l30d/_ltd` are
  `WHERE day >= today() - N` filters over `gh_repo_daily`, JOIN'd to this dimension
  `USING (repo_name)`.
- **Insert contract:** Acquisition inserts the exact column set above; missing API fields
  default to empty/0, `fetched_at = now()`. Bulk insert via the **native client** (HTTP
  bulk inserts die at the LB — see CLAUDE.md gotcha #2).

### 4.2 Typed JSON payload (Warehouse/read layer ⇄ Renderer)

DevScatter answer payload (drop-in for the existing render grammar):

```ts
type DevPoint = {
  actor: string;      // github login
  pushes: number;     // pushes_Nd
  repos: number;      // uniqExact(repo_name)
  commits: number;    // sum(commit_count)
  prs: number;        // PullRequestEvent count
  mergedPrs: number;  // sum(pr_merged)
};

type DevScatterPayload = {
  type: 'dev-scatter';
  window: '7d' | '30d';
  generatedAt: string;      // stamped after query, ISO
  points: DevPoint[];       // bots + script-spam pre-filtered by the read fn
  note?: string;            // e.g. dropped-count disclosure (no silent caps)
};
```

Metadata-enriched ticker item extends the existing `TickerItem` with the real
`description / language / topics / owner_type` pulled from the JOIN.

### 4.3 Visual spec (Design ⇄ Renderer)

Design freezes, as a contract Renderer implements against:
- terminal-dark tokens + verdict color mapping (ACCELERATING/PEAKING/COOLING/DORMANT/BREAKOUT/DIVERGENT);
- **DevScatter:** log-log axes (X = repos, Y = pushes), color = merge quality
  `mergedPrs/(prs+1)`, size = commits; legend text that makes the "script-goblins vs real
  builders" story obvious; empty/low-data state;
- ticker card layout when `description/language/topics` are present vs absent;
- motion vocabulary (reuse `.agents/skills/animation-vocabulary`, `apple-design`).

---

## 5. Dependency DAG

```
                 ┌─────────────────────────────────────────────┐
                 │ PHASE 0 — freeze contracts (Architect+PO+Design)│
                 │  • table+insert schema (§4.1)                │
                 │  • DevScatter payload schema (§4.2)          │
                 │  • visual spec (§4.3)                        │
                 └───────────────┬─────────────────────────────┘
                                 │  (frozen)
         ┌───────────────┬───────┴────────┬──────────────────┐
         ▼               ▼                ▼                  ▼
   Warehouse        Acquisition       Renderer            Design
   migration +      refresh job +     build vs FIXTURE   finalize tokens
   _lNd views +     GH REST +         payload (§4.2)     + motion detail
   read fns (§4.2)  bulk insert       (Recharts/ECharts)
         │               │                │                  │
         └──────┬────────┴────────┬───────┴──────────────────┘
                ▼                 ▼
        PHASE 2 — swap fixture→live, wire chat.agent tool → DevScatter answer, integrate
                                 │
                                 ▼
        PHASE 3 — Architect review gate → deploy (Trigger cloud + Vercel) → demo video
```

Critical path: **Phase 0 freeze → Acquisition lands live rows → Phase 2 swap.** Renderer is
*never* blocked on data because it builds against the fixture payload first.

---

## 6. Sequencing (contract-first, then parallel)

**Phase 0 — Freeze (Architect + PO + Design).**
- PO restates DoD + the demo question ("who are the real builders this week?").
- Architect writes §4.1 and §4.2 into a stub migration + a `fixtures/dev-scatter.json`.
- Design publishes the §4.3 visual spec.
- *Exit:* all three interfaces frozen and committed to a feature branch.

**Phase 1 — Parallel build (all four builders, against frozen interfaces).**
- **Warehouse:** goose migration for `gh_repo_metadata`; `_lNd` JOIN views; read fn in
  `src/lib/queries.ts` that returns `DevScatterPayload` — with human/script-spam filtering
  (exclude `[bot]`; flag single-repo mega-pushers; prefer `mergedPrs` + repo-spread) and a
  `note` disclosing any dropped rows.
- **Acquisition:** `refreshRepoMetadata` Trigger.dev job (import from `@trigger.dev/sdk`,
  never `/v3`) — pick repos to enrich (new-today + top-by-stars + stale `fetched_at`), GH
  REST with rate-limiting, map → §4.1, native-client bulk insert. Token via 1Password → env.
- **Renderer:** `DevScatter.tsx` + metadata-enriched ticker card, bound to the fixture
  payload, styled to the §4.3 spec.
- **Design:** finalize tokens/motion, review Renderer output against spec.
- *Exit:* migration applied in dev; job produces real rows; Renderer renders fixture cleanly.

**Phase 2 — Integrate.**
- Swap Renderer from fixture → live read fn.
- Wire the **chat.agent tool** so "who are the real builders this week?" routes to the
  DevScatter answer (this is the both-tools guard — see DoD).
- Ground the agent in the real schema (relates to issue #20) so it stops hallucinating.

**Phase 3 — Review gate + ship.**
- Architect review gate (Opus): contracts honored, gotchas respected (goose-only DDL, native
  bulk insert, MV backfill if any MV added, no `chat.defineJob`).
- Deploy: env vars in Trigger.dev dashboard first, then Trigger cloud + Vercel.
- Record the ≤5-min demo; confirm DoD met.

---

## 7. v2 continuation (after Jul 23 — dependency-driven order)

1. **Topic vocabulary** — needs the metadata `topics`/`language` from the hero slice to seed
   `SkinnyTopic`. Canonicalizes noisy Daily Skinny subject strings.
2. **Cross-source Attention Graph** — needs the topic vocab as its edge canonicalizer;
   TopicGraph / ThreadGraph via Cytoscape.js. Deliberately *second*, not the hero, so it has
   the metadata + vocab foundation underneath and doesn't render as a hairball.
3. **Sentiment / stance layer** — independent of 1–2; can slot in parallel once capacity frees.

Same six roles, same two seams, same contract-first cadence carry forward unchanged.

---

## 8. Risks & standing constraints every agent honors

- **Innovation ceiling (PO watch):** "enriched tickers" alone reads as "just charts."
  DevScatter must carry the innovation weight — the log-log "script-goblins vs real builders"
  read is the point. PO guards this in the demo cut.
- **Contract drift (Architect owns):** any change to §4.1–§4.3 is an Architect decision,
  broadcast to affected agents. This is the #1 failure mode of parallel builds.
- **CLAUDE.md gotchas** (non-negotiable): import from `@trigger.dev/sdk`; native client for
  bulk loads; goose-only DDL, register in issue #3; MVs need a manual backfill; GH firehose
  is discovery-only (per-repo precision needs REST — which is exactly what Acquisition adds).
- **Secrets:** GitHub token via 1Password Personal → `.env` → Trigger.dev dashboard env.
  Never inline.
- **Git:** feature branch + PR only, never push to main. `feat:` / `fix:` / `docs:` commits.
- **No silent caps:** the read fn must disclose dropped rows (bots/spam filtered) in `note`.
