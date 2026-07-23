# ADR 0007: Chart Selection & Model Benchmarking

- **Status**: Accepted
- **Date**: 2026-07-23
- **Context**: Hackathon documentation and agent evaluation

## Context

The project needed two supporting decisions:

1. A consistent way to map query intent to chart types so the UI stays readable.
2. A way to record and compare subagent runs across multiple model families.

## Decision

### 1. Chart selection

Instead of choosing chart types ad hoc, the rendering layer maps common data shapes to a small set of chart primitives:

| Data shape | Chart primitive | Reason |
| :--- | :--- | :--- |
| Small part-to-whole comparison | `PieChart` / donut | Easy to read when the number of slices is limited. |
| Category comparison | `StackedBarChart` | Shows both totals and composition. |
| Cumulative change | `WaterfallChart` | Makes step-by-step deltas explicit. |
| Dense volume comparison | `TreemapChart` | Uses space efficiently for many values. |
| Multi-variable correlation | `DevScatterChart` | Shows several dimensions at once. |

The rendering prompt also asks for one short takeaway and one verdict line before the chart so the user can understand the result without reading the whole card first.

### 2. Model benchmarking

The agent layer records every run in ClickHouse:

- `subagent_runs` stores individual executions, latency, token usage, and success state.
- `subagent_experiments` groups those runs so different models can be compared on the same task.

This makes it possible to measure cost, latency, and output quality over time instead of relying on anecdotal comparisons.

## Outcome

Accepted. The chart-selection rules and the benchmarking approach are now documented as project standards.
