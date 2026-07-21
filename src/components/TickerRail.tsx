"use client";

import { useEffect, useState } from "react";
import type { TickerCard, TickerLanes } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";

function Card({
  card,
  isSelected,
  onOpenRepo,
}: {
  card: TickerCard;
  isSelected?: boolean;
  onOpenRepo: (repoName: string) => void;
}) {
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
  if (card.repoName) {
    return (
      <div className={`tk-card tk-card-shell${isSelected ? " is-selected" : ""}`}>
        <button
          type="button"
          className="tk-card-button"
          title="Double-click to inspect this repo"
          onClick={(event) => {
            if (event.detail === 0) onOpenRepo(card.repoName!);
          }}
          onDoubleClick={() => onOpenRepo(card.repoName!)}
        >
          {inner}
        </button>
        {card.href && (
          <a className="tk-card-external mono" href={card.href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            GH
          </a>
        )}
      </div>
    );
  }
  return card.href ? (
    <a className="tk-card" href={card.href} target="_blank" rel="noreferrer">{inner}</a>
  ) : (
    <div className="tk-card">{inner}</div>
  );
}

function Lane({
  title,
  cards,
  selectedRepo,
  onOpenRepo,
}: {
  title: string;
  cards: TickerCard[];
  selectedRepo?: string;
  onOpenRepo: (repoName: string) => void;
}) {
  return (
    <div className="tk-lane">
      <div className="tk-lane-title mono">{title}</div>
      <div className="tk-scroll">
        {cards.map((c, i) => (
          <Card key={`${c.name}-${i}`} card={c} isSelected={c.repoName === selectedRepo} onOpenRepo={onOpenRepo} />
        ))}
      </div>
    </div>
  );
}

export function TickerRail({ initial, ingestToken }: { initial: TickerLanes; ingestToken?: string }) {
  const [lanes, setLanes] = useState(initial);
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [drilldown, setDrilldown] = useState<RepoDrilldownPayload | undefined>();
  const [loadingRepo, setLoadingRepo] = useState<string | undefined>();
  const [drilldownError, setDrilldownError] = useState<string | undefined>();
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

  async function openRepo(repoName: string) {
    setSelectedRepo(repoName);
    setLoadingRepo(repoName);
    setDrilldownError(undefined);
    try {
      const res = await fetch(`/api/repo-drilldown?repo=${encodeURIComponent(repoName)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "repo drill-down failed");
      setDrilldown(body as RepoDrilldownPayload);
    } catch (error) {
      setDrilldown(undefined);
      setDrilldownError(error instanceof Error ? error.message : "repo drill-down failed");
    } finally {
      setLoadingRepo(undefined);
    }
  }

  return (
    <section className="ticker" aria-label="Breakout ticker">
      <div className="tk-head mono">📌 PINNED · BREAKOUT TICKER <span className="muted">{ingestToken ? "ticks with ingestion" : "refreshes 60s"}</span></div>
      <Lane title="NEW REPOS" cards={lanes.newRepos} selectedRepo={selectedRepo} onOpenRepo={openRepo} />
      <Lane title="TOP FORKED · 24H" cards={lanes.topForked} selectedRepo={selectedRepo} onOpenRepo={openRepo} />
      <Lane title="SHIPPING VELOCITY · 24H" cards={lanes.shippingVelocity} selectedRepo={selectedRepo} onOpenRepo={openRepo} />
      <Lane title="STAR BREAKOUTS" cards={lanes.starBreakouts} selectedRepo={selectedRepo} onOpenRepo={openRepo} />
      <Lane title="RISING STORIES" cards={lanes.risingStories} selectedRepo={selectedRepo} onOpenRepo={openRepo} />
      {(loadingRepo || drilldownError || drilldown) && (
        <div className="ticker-drilldown">
          {loadingRepo && <div className="agent-tool mono">querying {loadingRepo}...</div>}
          {drilldownError && <div className="agent-fault mono" role="alert">! {drilldownError}</div>}
          {drilldown && <RenderedAnswer payload={drilldown} />}
        </div>
      )}
    </section>
  );
}
