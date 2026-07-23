# Storytelling with Data & UI Philosophies

> **Architectural Blueprint for Data Visualization, Narrative Arc, and SVG Chart Primitives in Attention Terminal**

## 1. Philosophical Foundations of Data Storytelling

The convergence of data visualization philosophies and modern frontend frameworks represents a critical evolution in interface engineering. Attention Terminal applies these principles to convert raw ClickHouse telemetry into immediate, narrative-driven insights.

### 1.1 The Narrative Arc & Preattentive Attributes
A narrative-driven analytical component follows a 4-stage arc:
1. **Hook**: The primary verdict tile or key breakout metric (`ACCELERATING`, `BREAKOUT`, `PEAKING`).
2. **Context**: Historical sparklines, 30-day timelines, or comparative benchmarks explaining *why* the hook matters.
3. **Evidence**: Granular quantitative SVG charts (`HorizontalBarChart`, `PieChart`, `StackedBarChart`, `WaterfallChart`, `TreemapChart`, `DevScatterChart`) allowing frictionless verification.
4. **Conclusion**: Direct links to HN threads, GitHub repos, and actionable prompt paths.

Preattentive visual properties (color intensity, size, spatial grouping, typography weight) guide the user's eye without instructional copy.

### 1.2 Tufte's Data-Ink Ratio & Chartjunk Elimination
Edward Tufte's core tenets govern all SVG primitives in `src/components/charts.tsx`:
- **Data-Ink Maximization**: Every pixel must communicate quantitative data. Gridlines are removed or dimmed to $\le 10\%$ opacity.
- **Direct Labeling**: Values sit directly adjacent to SVG bars, pie slices, or waterfall steps.
- **Range-Frame Axes**: SVG viewports span the exact range of plotted values.
- **Border Eradication**: Outer bounding boxes and heavy borders are omitted; spatial negative space defines boundaries.

---

## 2. Design Systems & Token Architecture

### 2.1 The Geist Paradigm: Monospaced Precision & Single-Accent Discipline
Attention Terminal adapts Vercel's Geist design language:
- **Monochrome Foundation**: Dark slate backgrounds (`#0c1017`) with crisp tabular text.
- **Tabular Numerics**: All numeric values, counts, and percentages apply `font-variant-numeric: tabular-nums` (via `.mono` / `.tabular-nums`) to prevent horizontal jitter during real-time updates.
- **Single-Accent Focus**: Muted base series (`var(--muted)`, `var(--line-soft)`), reserving high-contrast accents (`var(--cyan)`, `var(--mag)`, `var(--amber)`) for data anomalies and verdicts.

### 2.2 Typographic Hierarchy & Restraint
- Display & Section Headers: Semibold (600) with tight negative tracking (`letter-spacing: -0.02em`).
- Technical Output & Data Labels: `Geist Mono` / `ui-monospace` for commit hashes, telemetry metrics, and SVG chart annotations.

---

## 3. Map of SVG Chart Primitives (`src/components/charts.tsx`)

| Chart Primitive | Purpose | Key Encoding |
| :--- | :--- | :--- |
| `HorizontalBarChart` | Rank & distribution of nominal items (e.g. repo stars/forks) | Y-axis nominal labels, X-axis quantitative bar lengths |
| `PieChart` | Proportional share of totals | Donut arcs + centered aggregate total + percentage legend |
| `StackedBarChart` | Multi-category component breakdowns | Multi-segment horizontal bars with category key legend |
| `WaterfallChart` | Step-by-step delta & cumulative progression | Step deltas (+cyan, -magenta, total blue) with baseline line |
| `TreemapChart` | Hierarchical / volume spatial partitioning | Proportional 2D tile blocks with labels and values |
| `DevScatterChart` | Log-log multidimensional correlation | X=repos, Y=pushes, size=commits, color=merged PR ratio |
| `AreaChart` / `DualLine` | Time-series trend & divergence tracking | 30-day filled trend polygons with peak callouts |

---

## 4. Accessibility & Dual-Encoding Strategy

1. **Accessibility**: All SVG chart elements include standard `role="img"` and descriptive `aria-label` attributes for screen readers.
2. **Dual-Encoding**: Charts rely on distinct color hues combined with explicit numeric text callouts, shapes, or legend labels so information is clear regardless of vision modality or display hardware.
3. **Dark Mode Calibration**: SVG fill opacities (`0.82` - `0.88`) and de-saturated HSL colors prevent visual vibration against dark terminal surfaces.
