# Graphify Architecture Report

Generated locally with Graphify on commit `ef872475` using code-only extraction
and no LLM labeling.

## Snapshot

- Nodes: 138
- Edges: 168
- Communities: 20
- Extraction: 100% extracted edges, 0 inferred edges
- Import cycles: none detected

Raw generated files were left out of git:

- `graphify-out/graph.json`
- `graphify-out/graph.html`
- `graphify-out/GRAPH_REPORT.md`

## Main Runtime Path

Graphify found the primary public app path as:

```text
GET() --calls--> TickerLanes
```

The server route in `app/api/ticker/route.ts` calls the shared ticker query
contract in `src/lib/queries.ts`. The page component also consumes the same
query surface:

```text
Home() --> TickerLanes
Home() --> divergence()
Home() --> pulse()
Home() --> freshness()
Home() --> divergenceVerdict()
Home() --> seriesVerdict()
```

This confirms the current app shape:

- `app/page.tsx` composes the live answer surfaces.
- `src/lib/queries.ts` owns ClickHouse reads and provenance capture.
- `src/lib/verdicts.ts` owns deterministic verdict logic.
- `src/components/*` renders ticker, answer cards, and charts.
- `src/trigger/*` owns scheduled ingestion.

## Core Nodes

Most-connected nodes from the generated graph:

1. `compilerOptions` - 16 edges
2. `Home()` - 7 edges
3. `TickerLanes` - 7 edges
4. `include` - 6 edges
5. `seriesVerdict()` - 5 edges
6. `divergenceVerdict()` - 5 edges
7. `scripts` - 4 edges
8. `lib` - 4 edges
9. `Sparkline()` - 3 edges
10. `axisDays()` - 3 edges

The useful application hubs are `Home()`, `TickerLanes`, `seriesVerdict()`,
`divergenceVerdict()`, `Sparkline()`, and `axisDays()`. The TypeScript config
nodes are mechanically connected because Graphify includes config structure.

## Notable Findings

- No import cycles were detected.
- The app and API share `TickerLanes`, which is the right contract for keeping
  the pinned ticker and `/api/ticker` endpoint aligned.
- `ingestGhArchive` appears as a thin node because AST-only extraction does not
  infer scheduled runtime behavior from Trigger.dev declarations.
- SQL migrations are included after installing `graphifyy[sql]`; without that
  extra, migration files are skipped.

## Follow-Up Uses

- Use this report as demo support: Attention Terminal tracks attention while
  Graphify maps Attention Terminal's own code shape.
- Re-run Graphify after adding the agent/render-tool contract so the graph can
  show the route from user intent to rendered answer payload.
- If deeper semantic communities are needed, run Graphify with an LLM backend on
  a scrubbed working tree and review output before committing any derived docs.
