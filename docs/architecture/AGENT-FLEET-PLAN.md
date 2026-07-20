# Attention Terminal — Agent Fleet Plan

> Planning artifact only. No code is written and no agents are spawned by this
> document. It defines **who owns what**, the **contracts between them**, and the
> **order they build in**.
>
> **Inputs consolidated:** the July 20 product-exploration transcripts
> (`Attention Terminal - Chat Complete`) **and** the "Improving Attention Terminal
> App" design package — research narrative *Designing a Modern Alternative to
> Traditional News Aggregators*, the interactive `Chat Prototype` / `Attention
> Terminal.dc.html` prototype, and the `attention-terminal-design-system` tokens.

**Milestone:** demo-winning slice by **2026-07-23, midnight AoE (~3 days)**.
**Constraint:** the Jul 23 slice must be a *genuine vertical cut of the durable v2
architecture* — the same fleet continues the full backlog afterward, no throwaway.

---

## 0. Product vision (from the design doc)

**"A news terminal that ends."** The thesis is a deliberate rejection of the infinite
feed. Three pillars, each already latent in the product:

- **01 · FINISHABLE** — a bounded daily deck that *runs out*. Closure replaces the
  doomscroll; the session ends on a **SESSION COMPLETE** screen ("the feed does not
  refill — the terminal closes"). Grounded in the neurobiology of the variable-reward
  scroll and the "finishable experience" precedent (Circa's atomic cards, the failure of
  Flipboard's duplication and Artifact's soulless infinite feed).
- **02 · ATOMIC** — every outlet on a story deduped into **one card: a verdict, one
  visual, two sentences.** This *is* the locked answer grammar (`docs/ANSWER-GRAMMAR.md`).
- **03 · IN CONTEXT** — discussion rises in a **bottom sheet** over the card; the story
  never leaves the screen.

Identity: a **financial terminal** — dense, dark, monospace numerals, saturated color
reserved for signal. Voice: terse, lowercase, third-person; the agent *reports*, it does
not chat. Numbers are load-bearing and always cited with the threshold that earned them.

---

## 1. Locked decisions (the grilling record)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Objective / horizon | **Both** — hero feature by Jul 23, then continue v2 on the same rails. |
| 2 | Hero feature | **Thin tactile Daily Skinny + view-SQL** (revised after the design doc). Swipeable finishable card deck + flip-to-view-SQL + discussion-sheet peek + SESSION COMPLETE. **DevScatter** becomes one card visual + the "real builders" chat answer. `gh_repo_metadata` still underpins card content. Page-flip booklet, haptics, Fluid-compute pooling, and gesture telemetry are **deferred to v2**. |
| 3 | Form of this deliverable | **Planning doc only** — six charters + boundaries + DAG + sequence. No code, no spawned agents. |
| 4 | Data seam | Warehouse owns schema+contract+read; Acquisition owns fetch+populate. **Seam = schema + insert contract.** |
| 5 | PO vs Architect | Architect (Opus, also reviewer) owns technical DAG + contracts + review gate. PO owns scope + DoD + demo cut. |
| 6 | Design seam | Design owns visual/motion + **interaction** spec; Renderer owns implementation. **Seam = visual/interaction spec + payload schema.** |
| 7 | Sequencing | **Contract-first → parallel (fixtures) → swap live + integrate → review gate → demo.** |
| 8 | Definition of Done | A user swipes the finishable deck, flips a card to see the real ClickHouse SQL, opens the discussion sheet, and hits SESSION COMPLETE; the "real builders" DevScatter is chat-reachable; running deployed (Trigger cloud + Vercel); refresh job live; captured in the ≤5-min demo. |

**Cross-cutting pattern.** Every seam is *a spec/contract owner and an implementation owner,
meeting at a frozen interface.* That is the backbone that keeps the fleet coherent.

---

## 2. Backlog surfaced by the inputs

From the **transcripts**:
1. **Repo metadata is missing** — CH has only event/aggregate stats; every "what is this
   repo about?" answer was *inferred from the repo name*. → `gh_repo_metadata` dimension.
2. **"Cracked humans" is polluted** — bot detection is `[bot]`-pattern only; top human
   pushers are script-spam (`bolividob`, 46k pushes / 1 repo). → merge-rate / repo-spread /
   trending cross-ref. This is the DevScatter story.
3. **Structured topic vocabulary** — `SkinnyTopic { id, label, kind, sources }`.
4. **Attention Graph** — HN/GitHub/HF layers stitched by cross-layer edges.
5. **Sentiment / stance layer** — stance-tagging + thread-level narrative.

From the **design doc**:
6. **Finishable tactile shell** — swipe deck + page-flip digest + bottom-sheet discussion,
   built on Framer Motion + react-pageflip, ending in psychological closure.
7. **View-SQL transparency** — flip any card to reveal its ClickHouse query, `rows read`,
   `elapsed ms`. The literal "both-tools" proof.
8. **Durable edge architecture** — Vercel Fluid Compute connection pooling
   (`attachDatabasePool`), gesture telemetry streamed to ClickHouse. (v2 infra.)

The Jul 23 hero fuses **#1 + #2 + #6(thin) + #7**. The rest is sequenced in §7.

---

## 3. The six roles

| Role | Owns (authority) | Does NOT own | Model |
|------|------------------|--------------|-------|
| **Product Owner** | Scope, priority ordering, acceptance criteria / DoD, judging alignment, demo narrative + cut. Guards the finishable/atomic/in-context thesis. | Technical sequencing, contracts, code. | — |
| **Systems Architect** | Technical dependency DAG; **all interface contracts** (table+insert schema, Skinny card + DevScatter payloads, migration protocol); the **go/no-go review gate**. Owns contract-drift risk. The Opus reviewer. | Scope/priority (PO's), pixel/motion decisions (Design's). | Opus |
| **Data Warehouse** | ClickHouse DDL via goose; `gh_repo_metadata` shape + `_lNd` views; MVs/rollups; the `src/lib/queries.ts` read contract — including returning the **SQL text + `rows read` + `elapsed ms`** alongside each card's data (feeds view-SQL). | The population job; how data is fetched. | Sonnet |
| **Data Acquisition / Integration** | `refreshRepoMetadata` Trigger.dev job; GitHub REST fetch + rate-limit + field mapping; bulk insert into the agreed table. | Table shape, migrations, read layer. | Sonnet |
| **Design** | Visual **and interaction** spec: terminal-dark tokens (from `attention-terminal-design-system`), verdict colors, casing/voice rules, **card anatomy**, **swipe/flip/discuss** interaction model, **view-SQL** flip, **discussion sheet**, **SESSION COMPLETE**, DevScatter axes/scale/legend, and the **motion reconciliation** (see §4.4). Motion authority for the card deck is `.agents/skills/emil-design-eng` + `apple-design`, gated by `review-animations`; everything outside the deck stays motion-sparse per §4.4. | Component implementation. | Sonnet |
| **Visualization Renderer** | React/Framer-Motion implementation binding typed payloads → pixels: the swipe deck, the flip mechanic, the discussion sheet, SESSION COMPLETE, the DevScatter card visual. Extends existing `src/components/DailySkinny.tsx`, `AnswerCard.tsx`, `charts.tsx`. | Visual/interaction decisions, payload shape. | Sonnet |

Model assignment follows the standing preference: **execute with Sonnet, review with Opus**
(the Architect is the reviewer).

---

## 4. The frozen interfaces (Architect + Design freeze in Phase 0)

### 4.1 Table + insert contract (Warehouse ⇄ Acquisition)

`gh_repo_metadata` — one row per repo. **ReplacingMergeTree(fetched_at) ORDER BY repo_name**
(re-insert = correct update, same pattern as `hackernews`).

```
repo_name String  owner String  owner_type String  description String
language String  topics Array(String)  homepage String  license String
created_at DateTime  pushed_at DateTime  archived UInt8  fork UInt8
github_stars UInt64  github_forks UInt64  open_issues UInt64  fetched_at DateTime
```

- **Migration:** goose only, `migrations/2026071900000X_gh_repo_metadata.sql`. Register in
  issue #3. **Never ad-hoc DDL.**
- **Time windows** (`_l1d/_l7d/_l30d/_ltd`) are `WHERE day >= today() - N` filters over
  `gh_repo_daily`, JOIN'd to this dimension `USING (repo_name)`.
- **Insert:** Acquisition inserts the exact column set; missing API fields default empty/0,
  `fetched_at = now()`. Bulk insert via the **native client** (HTTP bulk dies at the LB —
  CLAUDE.md gotcha #2).

### 4.2 Skinny card payload (Warehouse/read layer ⇄ Renderer)

The atomic unit of the deck. One card = a deduped story with a verdict, one visual, ≤2
sentences — **plus** the query that produced it (for the flip).

```ts
type Verdict = 'ACCELERATING'|'PEAKING'|'COOLING'|'DORMANT'|'BREAKOUT'|'DIVERGENT';

type SkinnyCard = {
  id: string;
  subject: string;          // serif display
  verdict: Verdict;         // fixed vocabulary → fixed color (§4.4)
  metric: string;           // load-bearing number, e.g. '2.4x'
  metricLabel: string;      // e.g. 'talk/code spread'
  caption: string;          // ≤2 sentences, third-person
  sources: string;          // e.g. '200 HN · 121 repos'
  visual: SkinnyVisual;     // Divergence | Candles | DevScatter | Matrix | Ticker
  topComment?: { author: string; pts: number; ago: string; body: string };
  commentsCount?: number;
  hnThreadUrl?: string;
  // --- view-SQL flip ---
  sql: string;              // the exact ClickHouse query, formatted
  rowsRead: number;
  elapsedMs: number;
};

type SkinnyDeck = {
  type: 'skinny-deck';
  dateStr: string;
  generatedAt: string;      // stamped after query, ISO
  cards: SkinnyCard[];      // finite — the deck runs out (no refill)
};
```

`SkinnyVisual` is a discriminated union; **DevScatter** is one variant:

```ts
type DevPoint = { actor: string; pushes: number; repos: number; commits: number; prs: number; mergedPrs: number };
type DevScatterVisual = { kind: 'dev-scatter'; window: '7d'|'30d'; points: DevPoint[]; note?: string };
```

The **"real builders" chat answer** returns a single `SkinnyCard` whose `visual` is a
`DevScatterVisual` — so chat and deck share one contract.

### 4.3 Read-layer requirement (view-SQL)

Every card-producing read fn in `src/lib/queries.ts` returns `{ data, sql, rowsRead,
elapsedMs }`. ClickHouse exposes read stats via response summary/headers
(`send_progress_in_http_headers` is already set); the `sql` string is the exact query issued,
not a reconstruction. This is what makes the flip *true*, not decorative.

### 4.4 Visual + interaction spec (Design ⇄ Renderer)

Design freezes, as a contract Renderer implements against. Anchored to the
`attention-terminal-design-system` tokens (values verbatim from `app/globals.css`):

- **Tokens:** surfaces `--s #14171a → --panel #191d21 → --panel-2 #1f2429`; ink `--ink
  #cdd6dd` + muted alphas; **signal accents only** — `--cyan #38cdec` (talk/HN/ACCELERATING),
  `--mag #ff4f97` (code/GitHub/BREAKOUT/DIVERGENT), `--amber #f5b53d` (PEAKING). Verdict→color
  is a fixed mapping.
- **Type:** `--mono` for data/labels (tabular numerals), `--sans` for UI, `--serif` (Georgia)
  for display (`THE DAILY SKINNY`, subjects). Casing split by role: `UPPER_SNAKE` system
  labels, `ALLCAPS` verdicts, Title-Case serif editorial, lowercase everything else.
- **Card anatomy:** subject (serif) · verdict tile (color) · metric+label (mono) · caption
  (≤2 sentences) · sources · optional top-comment quote + count · `↺ view SQL` affordance.
- **Interaction model:** swipe left = **skip**, swipe right = **pin**; one card at a time;
  flip = **view SQL** (query + `rows read` + `elapsed ms`) then flip back; **discussion
  sheet** peeks with a trending comment, drags up to expand; **SESSION COMPLETE** when the
  deck empties (count read, pins kept, "the terminal closes").
- **Motion reconciliation (Design owns the call):** the design-system effects token says
  *sparse, functional, no bounces*. The research doc wants tactile spring physics. Resolution
  for Jul 23: **purposeful drag + spring only on the card deck** (tactility *is* the pillar-01
  point), everything else stays motion-sparse — instant color/border swaps, the 1s freshness
  tick, the `◉` ingestion pulse. No decorative entrance animations.
- **Deferred to v2 (spec, don't build):** react-pageflip digest booklet, haptics, modal-scrim
  sheet depth.

---

## 5. Dependency DAG

```
        ┌──────────────────────────────────────────────────────────────┐
        │ PHASE 0 — freeze (Architect + PO + Design)                     │
        │  • gh_repo_metadata table+insert contract (§4.1)               │
        │  • SkinnyCard/SkinnyDeck + DevScatter payloads (§4.2)          │
        │  • view-SQL read requirement (§4.3)                            │
        │  • visual + interaction spec incl. motion call (§4.4)          │
        └───────────────┬────────────────────────────────────────────────┘
                        │  (frozen)
      ┌─────────────┬───┴─────────┬────────────────────┬────────────────┐
      ▼             ▼             ▼                    ▼                ▼
 Warehouse     Acquisition    Renderer            Renderer          Design
 migration +   refresh job +  deck+flip+sheet     DevScatter        finalize
 _lNd views +  GH REST +      vs FIXTURE deck     card visual       tokens/motion
 read fns w/   bulk insert    (Framer Motion)     (fixture pts)     detail + review
 sql+stats
      │             │             │                    │                │
      └──────┬──────┴──────┬──────┴────────────────────┴────────────────┘
             ▼             ▼
     PHASE 2 — swap fixture→live deck, wire chat.agent 'real builders'→DevScatter card, integrate
                             │
                             ▼
     PHASE 3 — Architect review gate → deploy (Trigger cloud + Vercel) → demo video
```

Critical path: **Phase 0 freeze → Acquisition lands live rows + Warehouse read fns →
Phase 2 swap.** Renderer is *never* blocked on data — it builds the deck against a fixture
`SkinnyDeck` (including fixture `sql`/`rowsRead`/`elapsedMs`) first.

---

## 6. Sequencing (contract-first, then parallel)

**Phase 0 — Freeze (Architect + PO + Design).** PO restates the DoD + demo script (swipe →
flip-SQL → discuss → SESSION COMPLETE; "who are the real builders?"). Architect writes §4.1–4.3
into a stub migration + `fixtures/skinny-deck.json`. Design publishes §4.4. *Exit:* all
interfaces frozen on a feature branch.

**Phase 1 — Parallel build.**
- **Warehouse:** goose migration for `gh_repo_metadata`; `_lNd` JOIN views; read fns returning
  `{ data, sql, rowsRead, elapsedMs }`, incl. the DevScatter fn with human/script-spam
  filtering (exclude `[bot]`; flag single-repo mega-pushers; prefer `mergedPrs` + repo-spread)
  and a `note` disclosing dropped rows.
- **Acquisition:** `refreshRepoMetadata` Trigger.dev job (import from `@trigger.dev/sdk`,
  never `/v3`) — pick repos (new-today + top-by-stars + stale `fetched_at`), GH REST with
  rate-limiting, map → §4.1, native-client bulk insert. Token via 1Password → env.
- **Renderer:** swipe deck (Framer Motion drag/spring, pin/skip, `AnimatePresence`) + flip-to-
  view-SQL + discussion sheet peek + SESSION COMPLETE, bound to the fixture deck; plus the
  DevScatter card visual. Extends `DailySkinny.tsx` / `AnswerCard.tsx` / `charts.tsx`.
- **Design:** finalize tokens/motion, review Renderer output against §4.4.

*Exit:* migration applied in dev; job produces real rows; deck renders + flips + completes on
the fixture cleanly.

**Phase 2 — Integrate.** Swap deck fixture → live read fns; wire **chat.agent** so "who are the
real builders this week?" routes to a `SkinnyCard` with a `DevScatterVisual` (the both-tools
guard); ground the agent in the real schema (issue #20) so it stops hallucinating tables.

**Phase 3 — Review gate + ship.** Architect review (Opus): contracts honored, gotchas
respected (goose-only DDL, native bulk insert, MV backfill if any, `@trigger.dev/sdk` import,
view-SQL shows the *real* query). Deploy: env vars in Trigger.dev dashboard first, then Trigger
cloud + Vercel. Record the ≤5-min demo; confirm DoD.

---

## 7. v2 continuation (after Jul 23)

**v2.0 — Tactile depth (finish the design doc):** react-pageflip **digest booklet** as the
second reading mode, haptics, modal-scrim discussion depth. Pure design-doc polish; fully
specced in §4.4, deliberately deferred from the 3-day window.

**v2.1 — Topic vocabulary:** needs metadata `topics`/`language` to seed `SkinnyTopic`;
canonicalizes noisy Daily Skinny subjects.

**v2.2 — Cross-source Attention Graph:** needs the topic vocab as its edge canonicalizer;
TopicGraph / ThreadGraph via Cytoscape.js. Second, not hero, so it has the metadata + vocab
foundation and doesn't render as a hairball.

**v2.3 — Sentiment / stance layer:** independent; slots in parallel.

**Infra track (parallel, as load grows):** Vercel Fluid Compute connection pooling
(`attachDatabasePool`), gesture telemetry (swipe/flip/complete) streamed to ClickHouse for
retention-and-closure analytics — explicitly *not* session-length, per the design doc's
anti-dark-pattern stance.

Same six roles, same seams, same contract-first cadence carry forward unchanged.

---

## 8. Risks & standing constraints every agent honors

- **Front-end scope in 3 days (PO+Design watch):** the Framer-Motion deck + flip + sheet is
  the risk. Mitigations: fixture-first (Renderer never waits on data); page-flip booklet and
  haptics are explicitly v2; the deck degrades to tap-to-advance if drag physics slip.
- **View-SQL must be true (Architect gate):** the flip shows the *actual* issued query +
  real `rows read`/`elapsed ms`, never a hand-written mock. This is the both-tools proof; a
  faked query would be worse than none.
- **Innovation + theme (PO):** the finishable deck + view-SQL carries theme ("Beyond the Wall
  of Text") and innovation; DevScatter carries the analytical novelty. Guard both in the cut.
- **Contract drift (Architect owns):** any change to §4.1–§4.4 is an Architect decision,
  broadcast to affected agents. The #1 failure mode of parallel builds.
- **CLAUDE.md gotchas** (non-negotiable): import from `@trigger.dev/sdk`; native client for
  bulk loads; goose-only DDL, register in issue #3; MVs need a manual backfill; GH firehose is
  discovery-only (per-repo precision needs REST — exactly what Acquisition adds).
- **Secrets:** GitHub token via 1Password Personal → `.env` → Trigger.dev dashboard env. Never
  inline.
- **Git:** feature branch + PR only, never push to main. `feat:` / `fix:` / `docs:` commits.
- **No silent caps:** the DevScatter read fn discloses dropped rows (bots/spam) in `note`;
  the deck discloses its finite count on SESSION COMPLETE ("nothing more to load").
