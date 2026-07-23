import fs from "node:fs";
import path from "node:path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  HorizontalBarChart,
  PieChart,
  StackedBarChart,
  TreemapChart,
  WaterfallChart,
} from "../src/components/charts";

function RenderedPrimitivesEvidence() {
  return React.createElement(
    "div",
    { style: { background: "#0c1017", color: "#e2e8f0", fontFamily: "monospace", padding: "32px", maxWidth: "960px", margin: "0 auto" } },
    React.createElement("h1", { style: { borderBottom: "1px solid #1e293b", paddingBottom: "12px", color: "#38bdf8" } }, "ATTENTION TERMINAL — SVG PRIMITIVES RENDERED EVIDENCE (PR #208)"),
    React.createElement("p", { style: { color: "#94a3b8", fontSize: "14px" } }, "Tufte Data-Ink Maximized, Geist Monospaced Tabular Primitives for Morphing Cards & Dashboard Analytics"),
    React.createElement(
      "section",
      { style: { marginTop: "40px" } },
      React.createElement("h2", { style: { color: "#f472b6" } }, "1. PIE & DONUT CHART"),
      React.createElement(PieChart, {
        items: [
          { label: "React Ecosystem", value: 450 },
          { label: "AI & ML Frameworks", value: 320 },
          { label: "Databases & Storage", value: 210 },
          { label: "DevOps & Infrastructure", value: 140 },
        ],
        title: "Share of Repository Activity by Category",
      })
    ),
    React.createElement(
      "section",
      { style: { marginTop: "40px" } },
      React.createElement("h2", { style: { color: "#f472b6" } }, "2. STACKED BAR CHART"),
      React.createElement(StackedBarChart, {
        items: [
          {
            category: "clickhouse/clickhouse",
            segments: [
              { key: "commits", label: "Commits", value: 120 },
              { key: "pushes", label: "Pushes", value: 45 },
              { key: "prs", label: "PR Merges", value: 18 },
            ],
          },
          {
            category: "vercel/next.js",
            segments: [
              { key: "commits", label: "Commits", value: 95 },
              { key: "pushes", label: "Pushes", value: 32 },
              { key: "prs", label: "PR Merges", value: 22 },
            ],
          },
        ],
        title: "Activity Breakdown Across Repositories",
      })
    ),
    React.createElement(
      "section",
      { style: { marginTop: "40px" } },
      React.createElement("h2", { style: { color: "#f472b6" } }, "3. WATERFALL CHART"),
      React.createElement(WaterfallChart, {
        steps: [
          { label: "Start", delta: 100, type: "baseline" },
          { label: "Pushes 24h", delta: 120, type: "change" },
          { label: "PRs Merged", delta: 45, type: "change" },
          { label: "Bot Noise", delta: -25, type: "change" },
          { label: "Net Active", delta: 240, type: "total" },
        ],
        title: "24h Activity Delta Progression",
      })
    ),
    React.createElement(
      "section",
      { style: { marginTop: "40px" } },
      React.createElement("h2", { style: { color: "#f472b6" } }, "4. TREEMAP & HEATMAP GRID"),
      React.createElement(TreemapChart, {
        items: [
          { label: "vector-search", value: 8500 },
          { label: "llm-inference", value: 6200 },
          { label: "sql-engine", value: 4100 },
          { label: "auth-security", value: 2900 },
        ],
        title: "Topic Volume Spatial Heatmap",
      })
    ),
    React.createElement(
      "section",
      { style: { marginTop: "40px" } },
      React.createElement("h2", { style: { color: "#f472b6" } }, "5. HORIZONTAL BAR CHART"),
      React.createElement(HorizontalBarChart, {
        items: [
          { label: "codecrafters-io/build-your-own-x", value: 530410 },
          { label: "sindresorhus/awesome", value: 487928 },
          { label: "public-apis/public-apis", value: 452023 },
        ],
        title: "Top Repositories by Star Volume",
      })
    )
  );
}

const dir = path.join(process.cwd(), "docs/pr-evidence/208");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PR #208 SVG Primitives Evidence</title>
  <style>
    body { background: #0c1017; margin: 0; padding: 0; }
    .mono { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
    .chart svg { max-width: 100%; height: auto; display: block; }
    :root {
      --cyan: #38bdf8;
      --mag: #f472b6;
      --amber: #fbbf24;
      --blue: #60a5fa;
      --emerald: #34d399;
      --ink: #f8fafc;
      --muted: #94a3b8;
      --line: #334155;
      --line-soft: #1e293b;
      --s: #0f172a;
    }
  </style>
</head>
<body>
  ${ReactDOMServer.renderToStaticMarkup(React.createElement(RenderedPrimitivesEvidence))}
</body>
</html>`;

fs.writeFileSync(path.join(dir, "primitives-rendered-evidence.html"), html);
console.log("Committed evidence generated at docs/pr-evidence/208/primitives-rendered-evidence.html");
