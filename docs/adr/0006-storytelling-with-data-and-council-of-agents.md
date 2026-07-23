# ADR 0006: Storytelling with Data Principles & Council of Agents Architecture

- **Status**: Accepted
- **Date**: 2026-07-23
- **Context**: Hackathon Innovation & Multi-Agent Benchmarking Strategy

## Context & Problem Statement
To maximize innovation and solve the *Beyond the Wall of Text* challenge, Attention Terminal required two core breakthroughs:
1. **Visual Intuition System**: Implementing Cole Nussbaumer Knaflic's *Storytelling with Data* principles to map query intent directly to high-cognition SVG charts and instant intuition verdicts.
2. **Council of Agents**: Benchmarking and orchestrating multiple LLM reasoning models (`Gemini 3.6 Flash`, `Claude 3.5 Sonnet`, `Codex / GPT-5.1`, `GLM-5.2`) logged continuously to ClickHouse telemetry tables (`subagent_runs`, `subagent_experiments`).

## Decision Drivers & Technical Specifications

### 1. Storytelling with Data Principles
Rather than picking arbitrary chart types, prompt routing in `RenderedAnswer.tsx` selects SVG primitives based on *Storytelling with Data* cognitive mapping:

| Intent & Data Shape | Chart Primitive | Visual Design Rule |
| :--- | :--- | :--- |
| **Part-to-Whole Categorical ($\le 7$ items)** | `PieChart` (Donut) | Direct percentage callouts, center aggregate total, and `Other` slice capping. |
| **Multi-Category Group Comparisons** | `StackedBarChart` | Global key color index mapping (`segmentKeys.indexOf`) across all rows. |
| **Cumulative Delta Progression** | `WaterfallChart` | Color-coded step progression (+cyan, -magenta, total blue) with zero text overlap. |
| **2D Volume & Proportional Space** | `TreemapChart` | Proportional 2D tile layout heatmaps for high-density comparisons. |
| **Multi-Variable Correlation** | `DevScatterChart` | X=repos, Y=pushes, bubble size=commits, color=merged PR ratio. |

- **Prompting for Intuition**: Prompts explicitly enforce a single **Headline Takeaway** + **Verdict Badge** preceding every visual component, giving users immediate visual intuition before diving into interactive charts.

### 2. Council of Agents Multi-Model Framework
Attention Terminal coordinates a **Council of Agents**—a multi-model agent fleet where subagents run concurrently across model providers:
- **Telemetry Logging**: Every agent execution invokes `./scripts/log-subagent-run.sh` to record `session_id`, `prompt_id`, `model`, `latency_ms`, `input_tokens`, `output_tokens`, `cost_usd`, and `ok` status in ClickHouse `subagent_runs`.
- **Benchmarking View**: `subagent_experiments` aggregates performance metrics by model family (`Gemini`, `Claude`, `Codex`, `GLM`) to analyze cost efficiency vs reasoning quality.
- **Unified Review Protocol**: All agent PRs carry model labels (`gemini`, `codex`, `claude`) and adhere to automated CI polling and unresolved thread resolution gates.

## Decision Outcome
Accepted. *Storytelling with Data* charting logic and the *Council of Agents* multi-model benchmarking engine are fully codified and operational.
