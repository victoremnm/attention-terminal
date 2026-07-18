"use client";

import { useEffect, useState } from "react";
import type { TickerCard, TickerLanes } from "@/lib/queries";
import { Sparkline } from "./charts";

function Card({ card }: { card: TickerCard }) {
  const inner = (
    <>
      <span className="tk-kicker mono">{card.kicker}</span>
      <span className="tk-name">{card.name}</span>
      <span className="tk-metric mono">{card.metric}</span>
      <span className="tk-foot">
        {card.spark && card.spark.length > 1 && <Sparkline data={card.spark} color="var(--cyan)" w={52} h={14} />}
        {card.delta && <span className="tk-delta mono">{card.delta}</span>}
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

export function TickerRail({ initial }: { initial: TickerLanes }) {
  const [lanes, setLanes] = useState(initial);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/ticker");
        if (res.ok) setLanes(await res.json());
      } catch {
        // keep showing the last good data
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="ticker" aria-label="Breakout ticker">
      <div className="tk-head mono">📌 PINNED · BREAKOUT TICKER <span className="muted">refreshes 60s</span></div>
      <Lane title="NEW REPOS" cards={lanes.newRepos} />
      <Lane title="SHIPPING VELOCITY" cards={lanes.shippingVelocity} />
      <Lane title="STAR BREAKOUTS" cards={lanes.starBreakouts} />
      <Lane title="RISING STORIES" cards={lanes.risingStories} />
    </section>
  );
}
