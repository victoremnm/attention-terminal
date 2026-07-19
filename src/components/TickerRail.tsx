"use client";

import { useEffect, useState } from "react";
import type { TickerCard, TickerLanes } from "@/lib/queries";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";

function Card({ card }: { card: TickerCard }) {
  const stats = card.stats?.filter((stat) => stat.value !== "0").slice(0, 6) ?? [];
  const inner = (
    <>
      {card.spark && card.spark.length > 1 && (
        <span className="tk-card-top">
          <Sparkline data={card.spark} color="var(--cyan)" w={52} h={14} />
        </span>
      )}
      <span className="tk-name">{card.name}</span>
      <span className="tk-foot">
        <span className="tk-metric mono">{card.metric}</span>
        {card.delta && <span className="tk-delta mono">{card.delta}</span>}
      </span>
      <span className="tk-stats mono">
        {stats.map((stat) => (
          <span key={`${stat.label}-${stat.value}`} data-tone={stat.tone}>
            <b>{stat.value}</b> {stat.label}
          </span>
        ))}
      </span>
    </>
  );
  return card.href ? (
    <a className="tk-card" href={card.href} target="_blank" rel="noreferrer">{inner}</a>
  ) : (
    <div className="tk-card">{inner}</div>
  );
}

function Lane({ title, cards }: { title: string; cards: TickerCard[] }) {
  return (
    <div className="tk-lane">
      <div className="tk-lane-title mono">{title}</div>
      <div className="tk-scroll">
        {cards.map((c, i) => <Card key={`${c.name}-${i}`} card={c} />)}
      </div>
    </div>
  );
}

export function TickerRail({ initial, ingestToken }: { initial: TickerLanes; ingestToken?: string }) {
  const [lanes, setLanes] = useState(initial);
  // Ticks as ingestion lands (Trigger.dev Realtime); 0 while no run completed yet.
  const { lastIngestAt } = useIngestPulse(ingestToken);
  const ingestKey = lastIngestAt?.getTime() ?? 0;

  useEffect(() => {
    async function refetch() {
      try {
        const res = await fetch("/api/ticker");
        if (res.ok) setLanes(await res.json());
      } catch {
        // keep showing the last good data
      }
    }
    if (ingestKey) refetch();
    // 60s poll stays as the fallback when Realtime is unavailable.
    const t = setInterval(refetch, 60_000);
    return () => clearInterval(t);
  }, [ingestKey]);
  return (
    <section className="ticker" aria-label="Breakout ticker">
      <div className="tk-head mono">📌 PINNED · BREAKOUT TICKER <span className="muted">{ingestToken ? "ticks with ingestion" : "refreshes 60s"}</span></div>
      <Lane title="NEW REPOS" cards={lanes.newRepos} />
      <Lane title="TOP FORKED · 24H" cards={lanes.topForked} />
      <Lane title="SHIPPING VELOCITY · 24H" cards={lanes.shippingVelocity} />
      <Lane title="STAR BREAKOUTS" cards={lanes.starBreakouts} />
      <Lane title="RISING STORIES" cards={lanes.risingStories} />
    </section>
  );
}
