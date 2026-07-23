# Graph Report - .  (2026-07-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 968 nodes · 1676 edges · 87 communities (57 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2e2db710`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 82

## God Nodes (most connected - your core abstractions)
1. `repoDrilldown()` - 24 edges
2. `dailyDigest()` - 16 edges
3. `compilerOptions` - 16 edges
4. `RepoRankings()` - 14 edges
5. `exportAssetAsMarkdown()` - 14 edges
6. `useChatContext()` - 14 edges
7. `exportAssetAsHTML()` - 13 edges
8. `repoActivityWindow()` - 13 edges
9. `esc()` - 12 edges
10. `selectRows()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `AnalysisPage()` --calls--> `fetchTelemetryData()`  [EXTRACTED]
  app/analysis/page.tsx → src/lib/telemetry-queries.ts
- `GET()` --calls--> `fetchTelemetryData()`  [EXTRACTED]
  app/api/analysis/route.ts → src/lib/telemetry-queries.ts
- `GET()` --calls--> `dailyDigest()`  [EXTRACTED]
  app/api/digest/route.ts → src/lib/digest.ts
- `GET()` --calls--> `debateTakes()`  [EXTRACTED]
  app/api/digest/takes/route.ts → src/lib/digest.ts
- `GET()` --calls--> `repoDrilldown()`  [EXTRACTED]
  app/api/repo-drilldown/route.ts → src/lib/queries.ts

## Import Cycles
- None detected.

## Communities (87 total, 30 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (46): DeckPage(), dir, RenderedPrimitivesEvidence(), VERDICT_COLOR, AreaChart(), axisDays(), BarItem, CodeFrequencyChart() (+38 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (52): metadata, ACTIVE_SERVER_SORTS, ATTENTION_SERVER_SORTS, isServerSortSupported(), NUMBER, RankRow(), RepoRankings(), TABS (+44 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (39): logSessionLearningsPR208(), logTelemetryAndLearnings(), INGEST_SKIP_COLUMNS, IngestMeta, IngestTask, base, clickhouse, clickhouseInsert (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (46): buildMorphingCardDef, buildTablePayloadDef, describeTableDef, getDailyDigestDef, getRealBuildersDef, getRepoDrilldownDef, listTablesDef, renderAnswerDef (+38 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (31): metadata, AppShell(), AttentionChat(), MessagePart(), SUGGESTIONS, ChatTrigger(), AttentionChatOverlay(), FloatingChat() (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (44): ai, @ai-sdk/openai, @ai-sdk/otel, @ai-sdk/react, @clickhouse/client, framer-motion, isomorphic-dompurify, marked (+36 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (31): GET(), GET(), metadata, SkinnyPage(), asideStyle, ChatCtaBanner(), linkStyle, rowStyle (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (36): abortSignal(), CommitRow, fetchRepoActivity(), firstLine(), IssueRow, listRecentCommits(), listRecentIssues(), listRecentPRs() (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (27): handler, attentionRegistry, drilldownSpecHash(), glm, resolveAgentModel(), analystSystemPrompt, DATA_FETCH_TOOL_NAMES, shouldForceRenderAnswer() (+19 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (29): buildMorphingChart(), compact(), formatTableCell(), humanizeKey(), isFiniteNumeric(), isRecord(), MorphingCardAnswer(), MorphingCardRow (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (33): conventional-changelog-conventionalcommits, jsdom, devDependencies, conventional-changelog-conventionalcommits, jsdom, semantic-release, @semantic-release/changelog, @semantic-release/git (+25 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (32): areaChartSvg(), candlesHtml(), candlesMarkdown(), compact(), digestHtml(), digestMarkdown(), divergenceHtml(), divergenceMarkdown() (+24 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (30): ACTIVE_CONTRIBUTION_SORT_SQL, ACTIVE_CONTRIBUTION_WINDOW_DAYS, ActiveContributionResult, ActiveContributionSqlRow, ActorLeaderboardSqlRow, DailySeries, DEV_SCATTER_WINDOW_DAYS, DevScatterResult (+22 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (29): CandlesPayload, CandlesSchema, CandlesVisualSchema, CardQuery, DevPointSchema, DevScatterVisualSchema, DigestClusterSchema, DivergencePayload (+21 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (22): AnalysisPage(), GET(), AnalysisDashboard(), AnalysisDashboardProps, ModelDistributionChart(), ModelDistributionChartProps, missingColumns(), missingTables() (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (27): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts (+19 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (17): GET(), buildTrends(), commitRowsForActivity(), hasSeededAggregates(), highWaterValue(), isFlagged(), isTotalHourlyRow(), releaseActivityRows() (+9 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (13): GET(), ACTIVE_CONTRIBUTION_DEFAULT_LIMIT, ActiveContributionRequest, invalid(), parseActiveContributionRequest(), parseInteger(), SORTS, WINDOWS (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.14
Nodes (9): ActorLeaderboardCard(), ActorLeaderboardSurface, ActorLeaderboardTable(), formatCount(), TickerRail(), realtimeMock, useIngestPulse(), ActorLeaderboardRow (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (11): RenderedAnswer(), candlesPayload, digestPayload, divergencePayload, matrixPayload, morphingPayload, repoDrilldownPayload, skinnyDeckPayload (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.24
Nodes (12): invalid(), normalizeRepoActivityOptions(), parseInteger(), parseRepoActivityRequest(), REPO_ACTIVITY_DEFAULT_LIMIT, RepoActivityDirection, RepoActivityOptions, RepoActivityRequest (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (10): GET(), activityDelta(), mocks, ActorLeaderboard, assembleTickerLanes(), cachedTickerLanes, q(), stat() (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (9): ageLabel(), BAND_LABELS, DailySkinny(), VERDICT_COLOR, CopyBtn(), copyToClipboard(), DigestCluster, DigestPayload (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): GET(), repoActivityL1d(), repoActivityL30d(), repoActivityL7d(), repoActivityLtd(), repoActivityWindow(), repoWindowClause(), { repoActivityWindow }

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (7): devScatter(), devScatterSql(), divergence(), freshness(), hasCH, pulse(), toQueryResult()

### Community 25 - "Community 25"
Cohesion: 0.52
Nodes (6): block(), is_dev_config_file(), is_test_file(), pass(), scan.sh script, warn()

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (6): configureMocks(), mocks, rowsForQuery(), seededCommitRows, seededHourlyRows, seededTrendRows

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (5): gh_repo_commits, gh_repo_issues, gh_repo_prs, gh_repo_releases, watchlist

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (5): emptyPushRow, mocks, prOnlyRow, rankingRow, substantiveRow

### Community 29 - "Community 29"
Cohesion: 0.70
Nodes (4): subagent_api_events, subagent_evals, subagent_experiments, subagent_runs

### Community 30 - "Community 30"
Cohesion: 0.70
Nodes (3): insert_or_spool(), log-subagent-run.sh script, spool_row()

### Community 32 - "Community 32"
Cohesion: 0.50
Nodes (3): gh_repo_activity_feed, gh_repo_actor_hourly, gh_repo_drilldown_hourly

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (3): subagent_api_events, subagent_experiments, subagent_runs

### Community 34 - "Community 34"
Cohesion: 0.50
Nodes (3): gh_repo_hourly, github_events, hackernews

### Community 35 - "Community 35"
Cohesion: 0.50
Nodes (3): raw.github_events, raw.hackernews, raw.hf_model_snapshots

### Community 36 - "Community 36"
Cohesion: 0.50
Nodes (3): GOOSE_DBSTRING, GOOSE_DRIVER, migrate.sh script

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): OpenPr, reviewOpenPrs(), runCmd()

## Knowledge Gaps
- **296 isolated node(s):** `npx`, `handler`, `metadata`, `metadata`, `metadata` (+291 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RenderedPrimitivesEvidence()` connect `Community 0` to `Community 5`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `react` connect `Community 5` to `Community 0`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `repoDrilldown()` (e.g. with `highWaterValue()` and `isTotalHourlyRow()`) actually correct?**
  _`repoDrilldown()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `npx`, `handler`, `metadata` to the rest of the system?**
  _296 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05547785547785548 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07168458781362007 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.055523085914669784 - nodes in this community are weakly interconnected._