# ADR 0001: Tufte Data-Ink Maximization & Hand-Rolled SVG Chart Primitives

- **Status**: Accepted
- **Date**: 2026-07-23
- **Context**: Issue #180 (Morphing Canvas Chart Coverage)

## Context & Problem Statement
The Morphing Canvas previously defaulted non-bar payloads (such as Pie Chart, Stacked Bar Chart, Waterfall Chart, and Treemap requests) to raw tabular text views due to a lack of visual chart primitives. Heavy third-party charting libraries (Recharts, Chart.js) introduce runtime bundle bloat, DOM overhead, and unpredictable CSS layout reflows.

## Decision Drivers
1. **Data-Ink Ratio Maximization**: Edward Tufte's core principles dictate that every pixel must convey quantitative information. Outer bounding boxes, 3D effects, and heavy gridlines are eliminated or dimmed to $\le 10\%$ opacity.
2. **Monospaced Precision & Geist Aesthetics**: Tabular numbers (`tabular-nums` / `.mono`) prevent visual jitter during streaming data updates.
3. **Zero External Charting Dependencies**: All charts are hand-rolled as pure React SVG primitives (`PieChart`, `StackedBarChart`, `WaterfallChart`, `TreemapChart`, `HorizontalBarChart`, `DevScatterChart`) in `src/components/charts.tsx`.

## Considered Options
1. **Import Recharts / Chart.js**: Heavy bundle overhead, difficult to strictly enforce Tufte erasure rules.
2. **Hand-Rolled SVG Components (Chosen)**: Zero external bundle overhead, 100% control over geometry, dark mode opacities, accessibility attributes, and direct labeling.

## Decision Outcome
Accepted. Hand-rolled SVG primitives implemented in `src/components/charts.tsx` and wired into `RenderedAnswer.tsx` via `buildMorphingChart`.

### Key Edge-Case Rules Handled
- **Pie & Treemap Capping**: Categories beyond slice limits (7 for Pie, 8 for Treemap) aggregate into an explicit `Other` slice/tile so percentages sum to 100% and total width is covered cleanly.
- **Stacked Bar Color Mapping**: Colors map to global `segmentKeys.indexOf(seg.key)` so identical metric keys maintain consistent colors across rows.
- **Single-Slice Donut Ring**: 100% single-item pie charts render via SVG `<circle>` rings to prevent arc path degeneration.
