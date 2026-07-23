import type {
  CandlesPayload, DigestPayload, DigestCluster, DivergencePayload,
  MatrixPayload, MorphingCardPayload, RenderPayload, RepoDrilldownPayload,
  SkinnyDeckPayload, TickerPayload,
} from "./render-payload";

const STYLE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background:#14171a; color:#cdd6dd; font-family:system-ui,-apple-system,monospace; font-size:14px; line-height:1.5; padding:16px; }
a { color:#38cdec; }
.mono { font-family:ui-monospace,"SF Mono",monospace; font-variant-numeric:tabular-nums; }
.muted { color:rgba(255,255,255,0.42); }
table { width:100%; border-collapse:collapse; margin:8px 0; }
th,td { padding:6px 8px; border:1px solid rgba(255,255,255,0.16); text-align:left; font-size:12px; }
th { background:#1f2429; color:#cdd6dd; }
.verdict { font-weight:800; font-size:12px; letter-spacing:.05em; }
.kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(90px,1fr)); gap:6px; margin:8px 0; }
.kpi { border:1px solid rgba(255,255,255,0.16); border-radius:5px; padding:8px; background:rgba(31,36,41,0.8); }
.kpi b { display:block; font-size:16px; color:#cdd6dd; }
.kpi span { display:block; margin-top:3px; color:rgba(255,255,255,0.42); font-size:9px; }
.card-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin:8px 0; }
.card { border:1px solid rgba(255,255,255,0.16); border-radius:6px; padding:10px; }
.card b { display:block; font-size:13px; color:#cdd6dd; }
.card small { color:rgba(255,255,255,0.42); font-size:9px; }
.topic { display:flex; align-items:center; gap:10px; margin:6px 0; }
.topic b { font-size:14px; min-width:120px; }
.topic-bar { height:6px; border-radius:999px; background:rgba(255,255,255,0.08); flex:1; overflow:hidden; }
.topic-bar i { display:block; height:100%; border-radius:inherit; background:#38cdec; min-width:4px; }
.actors { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:4px; margin:8px 0; }
.actor { display:flex; justify-content:space-between; border-top:1px solid rgba(255,255,255,0.08); padding:6px 0; font-size:12px; }
.actor b { color:#cdd6dd; }
.actor span { color:rgba(255,255,255,0.42); }
.badge { display:inline-block; border:1px solid rgba(255,255,255,0.16); border-radius:3px; padding:1px 5px; font-size:9px; color:rgba(255,255,255,0.42); }
.row { display:grid; grid-template-columns:100px 70px 1fr 60px; gap:10px; align-items:center; padding:8px 0; border-top:1px solid rgba(255,255,255,0.08); font-size:12px; }
.row:first-child { border-top:0; }
.tag { display:inline-block; border:1px solid rgba(255,255,255,0.08); border-radius:3px; padding:2px 5px; color:#38cdec; font-size:9px; }
.feed { margin:6px 0; }
.feed-item { display:flex; gap:8px; border-top:1px solid rgba(255,255,255,0.08); padding:5px 0; font-size:11px; }
.feed-item span { color:rgba(255,255,255,0.42); min-width:40px; }
`;

const C = "#38cdec";
const M = "#ff4f97";
const A = "#f5b53d";
const E = "#34d399";
const INK = "#cdd6dd";
const LINE = "rgba(255,255,255,0.16)";
const MUTED = "rgba(255,255,255,0.42)";

function sparklineSvg(data: number[], color = C, w = 74, h = 22): string {
  if (!data || data.length < 2) return "";
  const max = Math.max(...data, 1);
  const pts = data
    .map((v, i) => {
      const x = ((i / (data.length - 1)) * (w - 2) + 1).toFixed(1);
      const y = (h - 2 - (v / max) * (h - 4)).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function wrap(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}</body></html>`;
}

function digestHtml(payload: DigestPayload): string {
  const rows = payload.clusters.map((c) => {
    const vc = verdictColor(c);
    return `<div class="row">
      <span class="verdict" style="color:${vc}">${c.verdict}</span>
      <span>${sparklineSvg(c.spark)}</span>
      <span><b>${esc(c.subject)}</b></span>
      <span class="muted">${Math.round(c.talkShare * 100)}% talk</span>
    </div>`;
  }).join("");
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">THE DAILY SKINNY · ${payload.clusters.length} clusters</div>${rows}`);
}

function tickerHtml(payload: TickerPayload): string {
  const cards = payload.items.map((item) =>
    `<div class="card"><small class="mono muted">${esc(item.kicker)}</small><b>${esc(item.name)}</b><div class="mono" style="color:${C};font-size:12px">${esc(item.metric)}</div></div>`
  ).join("");
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">BREAKOUT TICKER · ${esc(payload.filter)}</div><div class="card-grid">${cards}</div>`);
}

function divergenceHtml(payload: DivergencePayload): string {
  const chart = dualLineSvg(payload.days, payload.talk, payload.code, "#38cdec", "#ff4f97");
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">${esc(payload.subject)}</div>
    <span class="verdict" style="color:${verdictColorPayload(payload)}">${payload.verdict.state}</span>
    ${chart}
    <p style="margin-top:8px;color:rgba(255,255,255,0.76);font-size:12px">${esc(payload.caption)}</p>`);
}

function candlesHtml(payload: CandlesPayload): string {
  const chart = areaChartSvg(payload.days, payload.values, payload.caption);
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">${esc(payload.subject)}</div>
    <span class="verdict" style="color:${verdictColorPayload(payload)}">${payload.verdict.state}</span>
    ${chart}`);
}

function matrixHtml(payload: MatrixPayload): string {
  const maxVolume = Math.max(...payload.topics.map((t) => t.volume), 1);
  const topics = payload.topics.map((t) =>
    `<div class="topic"><b>${esc(t.name)}</b><span class="mono muted">velocity ${t.velocity.toFixed(1)}</span><div class="topic-bar"><i style="width:${Math.max(8, (t.volume / maxVolume) * 100)}%"></i></div></div>`
  ).join("");
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">MOMENTUM MATRIX · ${payload.topics.length} topics</div>${topics}`);
}

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortTime(value: string) {
  if (value.includes("T")) return value.slice(11, 16);
  if (value.includes(" ")) return value.slice(11, 16);
  return value.slice(0, 5);
}

function repoDrilldownHtml(payload: RepoDrilldownPayload): string {
  const kpis = [
    ["pushes", payload.kpis24h.pushes],
    ["commits", payload.kpis24h.commits],
    ["actors", payload.kpis24h.actors],
    ["stars", payload.kpis24h.stars],
    ["forks", payload.kpis24h.forks],
    ["PRs", payload.kpis24h.prsOpened],
    ["merged", payload.kpis24h.prsMerged],
    ["issues", payload.kpis24h.issuesOpened],
  ];
  const kpiHtml = kpis.map(([l, v]) =>
    `<div class="kpi"><b class="mono">${compact(v as number)}</b><span class="mono">${l} 24h</span></div>`
  ).join("");
  const meta = [
    payload.metadata.language || "unknown",
    `${compact(payload.metadata.githubStars)} stars`,
    `${compact(payload.metadata.githubForks)} forks`,
  ].map((t) => `<span class="badge">${esc(t)}</span>`).join(" ");
  const velChart = velocityChartSvg(payload);
  const actors = payload.topActors24h.length
    ? `<div style="margin-top:8px"><div class="mono muted" style="font-size:9px;letter-spacing:.14em;margin-bottom:4px">TOP CONTRIBUTORS 24H</div><div class="actors">${payload.topActors24h.map((a) =>
        `<div class="actor"><b>${esc(a.actor)}</b><span class="mono">${compact(a.commits)} commits</span></div>`
      ).join("")}</div></div>`
    : "";
  const feed = payload.feed.length
    ? `<div style="margin-top:8px"><div class="mono muted" style="font-size:9px;letter-spacing:.14em;margin-bottom:4px">LATEST EVENTS</div><div class="feed">${payload.feed.slice(0, 5).map((f) =>
        `<div class="feed-item"><span>${shortTime(f.at)}</span><b>${esc(f.actor)}</b><span class="muted">${f.eventType === "PushEvent" ? "push" : "PR"}</span></div>`
      ).join("")}</div></div>`
    : "";
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">REPO DRILL-DOWN · ${esc(payload.repoName)}</div>
    <div style="margin-bottom:4px">${meta}</div>
    <div class="kpi-grid">${kpiHtml}</div>
    ${velChart}${actors}${feed}`);
}

function morphingCardHtml(payload: MorphingCardPayload): string {
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">${payload.visualizationType.toUpperCase()}</div>
    <p style="color:rgba(255,255,255,0.78);font-size:13px">${esc(payload.summary || "Morphing card")}</p>`);
}

function skinnyDeckHtml(payload: SkinnyDeckPayload): string {
  const cards = payload.cards.map((c) =>
    `<div style="border:1px solid ${LINE};border-radius:8px;padding:12px;margin:6px 0;background:rgba(31,36,41,0.6)">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="verdict" style="color:${verdictColorStr(c.verdict)}">${c.verdict}</span>
      </div>
      <b style="font-size:15px">${esc(c.subject)}</b>
      <div style="margin:4px 0;font-size:12px"><b>${esc(c.metric)}</b> <span class="muted">${esc(c.metricLabel)}</span></div>
      <p style="color:rgba(255,255,255,0.76);font-size:12px">${esc(c.caption)}</p>
      <span class="muted" style="font-size:10px">${esc(c.sources)}</span>
    </div>`
  ).join("");
  return wrap(`<div class="mono muted" style="font-size:10px;letter-spacing:.12em;margin-bottom:8px">DAILY SKINNY DECK · ${payload.dateStr}</div>${cards}`);
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function verdictColor(v: { verdict: string }): string {
  return verdictColorStr(v.verdict);
}

function verdictColorStr(v: string): string {
  switch (v) {
    case "ACCELERATING": return C;
    case "PEAKING": return A;
    case "BREAKOUT": return M;
    case "DIVERGENT": return M;
    default: return MUTED;
  }
}

function verdictColorPayload(p: { verdict: { state: string } }): string {
  return verdictColorStr(p.verdict.state);
}

function dualLineSvg(days: string[], a: number[], b: number[], aColor: string, bColor: string): string {
  if (!days.length || a.length < 2) return "";
  const W = 640, H = 180, padL = 8, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const norm = (xs: number[]) => Math.max(...xs, 1);
  const line = (xs: number[], color: string) => {
    const mx = norm(xs);
    const pts = xs.map((v, i) => `${(padL + (i / (xs.length - 1)) * iw).toFixed(1)},${(padT + ih - (v / mx) * ih).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  const xLabels = (() => {
    const step = Math.max(1, Math.floor((days.length - 1) / 3));
    return days.filter((_, i) => i % step === 0 || i === days.length - 1)
      .map((d, i) => `<text x="${padL + (i * step / (days.length - 1)) * iw}" y="${H - 6}" font-size="9.5" fill="${MUTED}" text-anchor="middle">${d.slice(5)}</text>`)
      .join("");
  })();
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin:4px 0">
    <line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" stroke="${LINE}" stroke-width="1"/>
    ${xLabels}
    ${line(a, aColor)}
    ${line(b, bColor)}
  </svg>
  <div style="display:flex;gap:12px;font-size:10px;color:${MUTED};margin-top:4px">
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${aColor};margin-right:4px"></span> talk · HN</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${bColor};margin-right:4px"></span> code · GH</span>
  </div>`;
}

function areaChartSvg(days: string[], values: number[], label: string): string {
  if (!days.length || values.length < 2) return "";
  const W = 640, H = 200, padL = 30, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(Math.ceil(Math.max(...values, 1) / 5) * 5, 5);
  const x = (i: number) => padL + (i / (values.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const peak = values.indexOf(Math.max(...values));
  const xLabels = (() => {
    const step = Math.max(1, Math.floor((days.length - 1) / 3));
    return days.filter((_, i) => i % step === 0 || i === days.length - 1)
      .map((d, i) => `<text x="${x(i * step)}" y="${H - 6}" font-size="9.5" fill="${MUTED}" text-anchor="middle">${d.slice(5)}</text>`)
      .join("");
  })();
  const yGrid = [0, 0.5, 1].map((t) =>
    `<line x1="${padL}" x2="${W - padR}" y1="${y(max * t)}" y2="${y(max * t)}" stroke="${LINE}" stroke-width="1"/>`
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin:4px 0">
    ${yGrid}
    ${xLabels}
    <polygon points="${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}" fill="${C}" opacity="0.13"/>
    <polyline points="${pts}" fill="none" stroke="${C}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="3.5" fill="${C}" stroke="#14171a" stroke-width="2"/>
    <text x="${x(peak)}" y="${y(values[peak]) - 6}" font-size="10" font-weight="700" fill="${INK}" text-anchor="middle">${values[peak]}</text>
  </svg>
  <div style="font-size:10px;color:${MUTED}">${esc(label)}</div>`;
}

function velocityChartSvg(payload: RepoDrilldownPayload): string {
  const rows = payload.velocity;
  if (rows.length < 2) return "";
  const W = 640, H = 180, padL = 34, padR = 10, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(...rows.flatMap((r) => [r.pushes, r.commits, r.stars]), 1);
  const x = (i: number) => padL + (i / (rows.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = (values: number[], color: string) => {
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  const xLabels = (() => {
    const step = Math.max(1, Math.floor((rows.length - 1) / 3));
    return rows.filter((_, i) => i % step === 0 || i === rows.length - 1)
      .map((r, i) => `<text x="${x(i * Math.max(1, Math.floor((rows.length - 1) / 3)))}" y="${H - 6}" font-size="9.5" fill="${MUTED}" text-anchor="middle">${shortTime(r.hour)}</text>`)
      .join("");
  })();
  const yGrid = [0, 0.5, 1].map((t) =>
    `<line x1="${padL}" x2="${W - padR}" y1="${y(max * t)}" y2="${y(max * t)}" stroke="${LINE}" stroke-width="1"/>`
  ).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin:4px 0">
    ${yGrid}
    ${xLabels}
    ${line(rows.map((r) => r.pushes), C)}
    ${line(rows.map((r) => r.commits), M)}
    ${line(rows.map((r) => r.stars), A)}
  </svg>
  <div style="display:flex;gap:12px;font-size:10px;color:${MUTED};margin-top:4px">
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C};margin-right:4px"></span> pushes</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${M};margin-right:4px"></span> commits</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${A};margin-right:4px"></span> stars</span>
  </div>`;
}

export function exportAssetAsMarkdown(payload: RenderPayload): string {
  switch (payload.type) {
    case "digest": return digestMarkdown(payload);
    case "ticker": return tickerMarkdown(payload);
    case "divergence": return divergenceMarkdown(payload);
    case "candles": return candlesMarkdown(payload);
    case "matrix": return matrixMarkdown(payload);
    case "skinny-deck": return skinnyDeckMarkdown(payload);
    case "repo-drilldown": return repoDrilldownMarkdown(payload);
    case "morphing-card": return morphingCardMarkdown(payload);
  }
}

function digestMarkdown(payload: DigestPayload): string {
  const lines: string[] = [
    `### THE DAILY SKINNY`,
    `*Floor: ${payload.noiseFloor.toFixed(2)} | ${payload.clusters.length} Clusters*`,
    ``,
    `| Verdict | Subject | Share | Sources |`,
    `| :--- | :--- | :--- | :--- |`,
  ];
  for (const c of payload.clusters) {
    const sources = `[HN (${c.sources.hnThreads} thr)](${c.links.hn}) · [GH (${c.sources.ghStars24h}⭐ / ${c.sources.repos} repo)](${c.links.github})`;
    lines.push(`| **${c.verdict}** | [**${c.subject}**](${c.links.hn})<br/>*${c.skinny}* | ${Math.round(c.talkShare * 100)}% | ${sources} |`);
  }
  return lines.join("\n");
}

function tickerMarkdown(payload: TickerPayload): string {
  const lines: string[] = [
    `### BREAKOUT TICKER · ${payload.filter}`,
    ``,
    `| Kicker | Name | Metric | Delta |`,
    `| :--- | :--- | :--- | :--- |`,
  ];
  for (const item of payload.items) {
    const link = item.href ? `[**${item.name}**](${item.href})` : `**${item.name}**`;
    lines.push(`| ${item.kicker} | ${link} | \`${item.metric}\` | ${item.delta ?? "-"} |`);
  }
  return lines.join("\n");
}

function divergenceMarkdown(payload: DivergencePayload): string {
  const lines: string[] = [
    `### ${payload.subject}`,
    `**Verdict**: **${payload.verdict.state}** (${payload.verdict.metric} ${payload.verdict.metricLabel})`,
    ``,
    payload.caption,
    ``,
    `| Day | Talk Volume | Code Activity |`,
    `| :--- | :--- | :--- |`,
  ];
  for (let i = 0; i < payload.days.length; i++) {
    lines.push(`| ${payload.days[i]} | ${payload.talk[i]} | ${payload.code[i]} |`);
  }
  return lines.join("\n");
}

function candlesMarkdown(payload: CandlesPayload): string {
  const lines: string[] = [
    `### ${payload.subject}`,
    `**Verdict**: **${payload.verdict.state}** (${payload.verdict.metric} ${payload.verdict.metricLabel})`,
    ``,
    payload.caption,
    ``,
    `| Day | Value |`,
    `| :--- | :--- |`,
  ];
  for (let i = 0; i < payload.days.length; i++) {
    lines.push(`| ${payload.days[i]} | ${payload.values[i]} |`);
  }
  return lines.join("\n");
}

function matrixMarkdown(payload: MatrixPayload): string {
  const lines: string[] = [
    `### MOMENTUM MATRIX · ${payload.topics.length} topics`,
    ``,
    `| Topic | Velocity | Volume | Verdict |`,
    `| :--- | :--- | :--- | :--- |`,
  ];
  for (const t of payload.topics) {
    lines.push(`| **${t.name}** | ${t.velocity.toFixed(1)} | ${t.volume} | ${t.verdict ?? "-"} |`);
  }
  return lines.join("\n");
}

function skinnyDeckMarkdown(payload: SkinnyDeckPayload): string {
  const lines: string[] = [`### DAILY SKINNY DECK · ${payload.dateStr}`, ``];
  for (const c of payload.cards) {
    lines.push(`#### ${c.subject}`);
    lines.push(`**Verdict**: **${c.verdict}** (${c.metric} ${c.metricLabel})`);
    lines.push(c.caption);
    lines.push(`*Sources*: ${c.sources}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function repoDrilldownMarkdown(payload: RepoDrilldownPayload): string {
  const lines: string[] = [
    `### Repo Drilldown: [${payload.repoName}](https://github.com/${payload.repoName})`,
    `*${payload.metadata.description}*`,
    ``,
    `**Language**: ${payload.metadata.language} | ⭐ **Stars**: ${payload.metadata.githubStars.toLocaleString()} | 🍴 **Forks**: ${payload.metadata.githubForks.toLocaleString()} | 🐛 **Issues**: ${payload.metadata.openIssues.toLocaleString()}`,
    ``,
  ];
  if (payload.topActors24h && payload.topActors24h.length > 0) {
    lines.push(`#### Top Contributors (24h)`);
    lines.push(`| Actor | Pushes | Commits | PRs Opened | PRs Merged |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const a of payload.topActors24h) {
      lines.push(`| **${a.actor}** | ${a.pushes} | ${a.commits} | ${a.prsOpened} | ${a.prsMerged} |`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function morphingCardMarkdown(payload: MorphingCardPayload): string {
  const lines: string[] = [`### ${payload.visualizationType.toUpperCase()}`];
  if (payload.summary) {
    lines.push(payload.summary);
    lines.push(``);
  }
  const isRecord = (val: unknown): val is Record<string, unknown> => typeof val === "object" && val !== null;
  const config = payload.chartConfig as Record<string, unknown>;
  const dataValues = isRecord(config?.data) && Array.isArray(config.data.values)
    ? config.data.values.filter(isRecord)
    : [];

  if (dataValues.length > 0) {
    const keys = Object.keys(dataValues[0]);
    lines.push(`| ${keys.join(" | ")} |`);
    lines.push(`| ${keys.map(() => ":---").join(" | ")} |`);
    for (const row of dataValues) {
      lines.push(`| ${keys.map((k) => String(row[k] ?? "")).join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

export function exportAssetAsHTML(payload: RenderPayload): string {
  switch (payload.type) {
    case "digest": return digestHtml(payload);
    case "ticker": return tickerHtml(payload);
    case "divergence": return divergenceHtml(payload);
    case "candles": return candlesHtml(payload);
    case "matrix": return matrixHtml(payload);
    case "skinny-deck": return skinnyDeckHtml(payload);
    case "repo-drilldown": return repoDrilldownHtml(payload);
    case "morphing-card": return morphingCardHtml(payload);
  }
}

export async function copyToClipboard(content: string, format: "markdown" | "html" = "markdown"): Promise<void> {
  const plainText = format === "markdown" ? content : content.replace(/<[^>]*>/g, "").trim() || "Attention Terminal rendered asset";
  try {
    if (format === "html" && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      const item = new ClipboardItem({
        "text/html": new Blob([content], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    }
    await navigator.clipboard.writeText(content);
  } catch {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      throw new Error("Clipboard API unavailable");
    }
  }
}
