"use client";

import type { CandlesPayload, DigestPayload, DivergencePayload, MatrixPayload, RenderPayload, TickerPayload, VerdictTile } from "@/lib/render-payload";
import { VERDICT_COLOR } from "@/lib/verdict-color";
import { AreaChart, DualLine, Sparkline } from "./charts";
import { SkinnyDeck } from "./SkinnyDeck";

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
            {item.stats && (
              <span className="agent-ticker-stats mono">
                {item.stats.filter((stat) => stat.value !== "0").slice(0, 4).map((stat) => (
                  <em key={`${stat.label}-${stat.value}`} data-tone={stat.tone}>
                    {stat.value} {stat.label}
                  </em>
                ))}
              </span>
            )}
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

export function RenderedAnswer({ payload }: { payload: RenderPayload }) {
  if (payload.type === "digest") return <DigestAnswer payload={payload} />;
  if (payload.type === "ticker") return <TickerAnswer payload={payload} />;
  if (payload.type === "divergence") return <DivergenceAnswer payload={payload} />;
  if (payload.type === "candles") return <CandlesAnswer payload={payload} />;
  if (payload.type === "skinny-deck") return <SkinnyDeck payload={payload} />;
  return <MatrixAnswer payload={payload} />;
}
