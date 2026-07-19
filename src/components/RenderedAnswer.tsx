"use client";

import { useMemo } from "react";
import type { CandlesPayload, DigestPayload, DivergencePayload, GraphPayload, MatrixPayload, RenderPayload, TickerPayload, VerdictTile } from "@/lib/render-payload";
import { AreaChart, DualLine, Sparkline } from "./charts";

const VERDICT_COLOR: Record<string, string> = {
  ACCELERATING: "var(--cyan)",
  PEAKING: "var(--amber)",
  COOLING: "var(--muted)",
  DORMANT: "var(--muted)",
  BREAKOUT: "var(--mag)",
  DIVERGENT: "var(--mag)",
};

function VerdictBadge({ verdict }: { verdict: VerdictTile }) {
  return (
    <div className="agent-verdict mono" title={verdict.rule}>
      <b style={{ color: VERDICT_COLOR[verdict.state] }}>{verdict.state}</b>
      <span>{verdict.metric} {verdict.metricLabel}</span>
      {verdict.detail && <i>{verdict.detail}</i>}
    </div>
  );
}

function DigestAnswer({ payload }: { payload: DigestPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">
        THE DAILY SKINNY
        <span>{payload.clusters.length} clusters · floor {payload.noiseFloor.toFixed(2)}</span>
      </div>
      <div className="agent-digest-list">
        {payload.clusters.map((cluster) => (
          <article key={cluster.id} className="agent-digest-row">
            <div className="mono agent-digest-verdict" style={{ color: VERDICT_COLOR[cluster.verdict] }}>{cluster.verdict}</div>
            <Sparkline data={cluster.spark} color={VERDICT_COLOR[cluster.verdict]} w={74} h={22} />
            <div>
              <h3>
                <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.subject}</a>
              </h3>
              <p>{cluster.skinny}</p>
              <span className="mono">
                <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.sources.hnThreads} HN</a>
                {" · "}{cluster.sources.comments} cmts{" · "}
                <a href={cluster.links.github} target="_blank" rel="noreferrer">{cluster.sources.ghStars24h} stars · {cluster.sources.repos} repos</a>
              </span>
            </div>
            <div className="mono agent-share">{Math.round(cluster.talkShare * 100)}% talk</div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TickerAnswer({ payload }: { payload: TickerPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">BREAKOUT TICKER <span>{payload.filter}</span></div>
      <div className="agent-ticker-grid">
        {payload.items.map((item, index) => (
          <a key={`${item.name}-${index}`} className="agent-ticker-card" href={item.href} target={item.href ? "_blank" : undefined} rel="noreferrer">
            <span className="mono">{item.kicker}</span>
            <b>{item.name}</b>
            <i className="mono">{item.metric}</i>
            {item.delta && <small className="mono">{item.delta}</small>}
          </a>
        ))}
      </div>
    </div>
  );
}

function DivergenceAnswer({ payload }: { payload: DivergencePayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">{payload.subject}</div>
      <VerdictBadge verdict={payload.verdict} />
      <DualLine days={payload.days} a={payload.talk} b={payload.code} aLabel="talk · HN" bLabel="code · GH" />
      <p className="agent-caption">{payload.caption}</p>
    </div>
  );
}

function CandlesAnswer({ payload }: { payload: CandlesPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">{payload.subject}</div>
      <VerdictBadge verdict={payload.verdict} />
      <AreaChart days={payload.days} values={payload.values} label={payload.caption} />
    </div>
  );
}

function MatrixAnswer({ payload }: { payload: MatrixPayload }) {
  const maxVolume = Math.max(...payload.topics.map((topic) => topic.volume), 1);
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">MOMENTUM MATRIX <span>{payload.topics.length} topics</span></div>
      <div className="agent-matrix">
        {payload.topics.map((topic) => (
          <div key={topic.name} className="agent-matrix-topic">
            <b>{topic.name}</b>
            <span className="mono">velocity {topic.velocity.toFixed(1)} · {Math.round(topic.ghShare * 100)}% code</span>
            <i style={{ width: `${Math.max(8, (topic.volume / maxVolume) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const GROUP_COLOR: Record<string, string> = {
  topic: "var(--cyan)",
  repo: "var(--mag)",
  story: "var(--amber)",
  actor: "var(--lime)",
  model: "var(--violet)",
};

function GraphAnswer({ payload }: { payload: GraphPayload }) {
  const width = 640;
  const height = 420;

  const layout = useMemo(() => {
    const nodes = payload.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      group: n.group,
      value: Math.max(2, Math.sqrt(n.value) * 1.5),
      x: width / 2 + (Math.random() - 0.5) * 40,
      y: height / 2 + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = payload.edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ ...e, sourceNode: nodeById.get(e.source)!, targetNode: nodeById.get(e.target)! }));

    const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

    for (let i = 0; i < 120; i++) {
      // Repulsion
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a];
          const nb = nodes[b];
          let dx = na.x - nb.x;
          let dy = na.y - nb.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (8000 / (dist * dist)) || 0;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          na.vx += fx;
          na.vy += fy;
          nb.vx -= fx;
          nb.vy -= fy;
        }
      }

      // Attraction along edges
      for (const e of edges) {
        const na = e.sourceNode;
        const nb = e.targetNode;
        let dx = nb.x - na.x;
        let dy = nb.y - na.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 80 + (e.weight / maxWeight) * 60;
        const force = ((dist - target) * 0.003) || 0;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        na.vx += fx;
        na.vy += fy;
        nb.vx -= fx;
        nb.vy -= fy;
      }

      // Center gravity
      for (const n of nodes) {
        n.vx += (width / 2 - n.x) * 0.002;
        n.vy += (height / 2 - n.y) * 0.002;
        n.vx *= 0.6;
        n.vy *= 0.6;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(20, Math.min(width - 20, n.x));
        n.y = Math.max(20, Math.min(height - 20, n.y));
      }
    }

    return { nodes, edges, maxWeight };
  }, [payload]);

  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">GRAPH <span>{layout.nodes.length} nodes · {layout.edges.length} edges</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} className="agent-graph" style={{ width: "100%", height: "auto", background: "var(--surface)" }}>
        {layout.edges.map((e, i) => (
          <line
            key={`edge-${i}`}
            x1={e.sourceNode.x}
            y1={e.sourceNode.y}
            x2={e.targetNode.x}
            y2={e.targetNode.y}
            stroke="var(--muted)"
            strokeOpacity={0.25 + (e.weight / layout.maxWeight) * 0.55}
            strokeWidth={1 + (e.weight / layout.maxWeight) * 2}
          />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
            <circle r={n.value} fill={GROUP_COLOR[n.group] ?? "var(--fg)"} fillOpacity={0.85} stroke="var(--surface)" strokeWidth={2} />
            <text
              y={n.value + 12}
              textAnchor="middle"
              fill="var(--fg)"
              fontSize={10}
              fontFamily="var(--font-mono)"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="agent-caption">{payload.caption}</p>
    </div>
  );
}

export function RenderedAnswer({ payload }: { payload: RenderPayload }) {
  if (payload.type === "digest") return <DigestAnswer payload={payload} />;
  if (payload.type === "ticker") return <TickerAnswer payload={payload} />;
  if (payload.type === "divergence") return <DivergenceAnswer payload={payload} />;
  if (payload.type === "candles") return <CandlesAnswer payload={payload} />;
  if (payload.type === "graph") return <GraphAnswer payload={payload} />;
  return <MatrixAnswer payload={payload} />;
}
