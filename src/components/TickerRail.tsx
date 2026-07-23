"use client";

import { useEffect, useRef, useState } from "react";
import type { TickerCard, TickerLanes } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { ActorLeaderboardCard } from "./ActorLeaderboard";
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";
import { copyToClipboard } from "@/lib/asset-export";

function Card({
  card,
  state,
  onOpenRepo,
}: {
  card: TickerCard;
  state?: "loading" | "selected";
  onOpenRepo: (repoName: string) => void;
}) {
  const stats = card.stats?.filter((stat) => stat.value !== "0").slice(0, 6) ?? [];
  const actionLabel = state === "loading" ? "rendering..." : state === "selected" ? "rendered below" : undefined;
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
      <div className={`tk-card tk-card-shell${state ? ` is-${state}` : ""}`}>
        <button
          type="button"
          className="tk-card-button"
          aria-label={`Render live ClickHouse data for ${card.repoName}`}
          title="Click to render this repo's live data"
          onClick={() => onOpenRepo(card.repoName!)}
        >
          {inner}
          {actionLabel && <span className="tk-action mono">{actionLabel}</span>}
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
  loadingRepo,
  onOpenRepo,
}: {
  title: string;
  cards: TickerCard[];
  selectedRepo?: string;
  loadingRepo?: string;
  onOpenRepo: (repoName: string) => void;
}) {
  return (
    <div className="tk-lane">
      <div className="tk-lane-title mono">{title}</div>
      <div className="tk-scroll">
        {cards.map((c, i) => (
          <Card
            key={`${c.name}-${i}`}
            card={c}
            state={c.repoName === loadingRepo ? "loading" : c.repoName === selectedRepo ? "selected" : undefined}
            onOpenRepo={onOpenRepo}
          />
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
  const [copiedTickerMd, setCopiedTickerMd] = useState(false);

  async function handleCopyTickerMd() {
    try {
      const lines: string[] = [`### BREAKOUT TICKER`, ``];
      const laneConfigs = [
        { key: "newRepos", title: "NEW REPOS 24H" },
        { key: "topForked", title: "FORKED 24H" },
        { key: "shippingVelocity", title: "SHIPPING VELOCITY" },
        { key: "starBreakouts", title: "STAR BREAKOUTS" },
        { key: "risingStories", title: "HN STORIES" },
      ] as const;
      for (const { key, title } of laneConfigs) {
        const cards = lanes[key] ?? [];
        if (cards.length === 0) continue;
        lines.push(`#### ${title}`);
        lines.push(`| Name | Metric | Delta |`);
        lines.push(`| :--- | :--- | :--- |`);
        for (const c of cards) {
          const link = c.href ? `[**${c.name}**](${c.href})` : `**${c.name}**`;
          lines.push(`| ${link} | \`${c.metric}\` | ${c.delta ?? "-"} |`);
        }
        lines.push(``);
      }
      if (lanes.actors) {
        lines.push(`#### PROLIFIC ACTORS 24H`);
        lines.push(`| Group | Actor | Score | Events | Repos | Pushes | PRs opened | PRs merged |`);
        lines.push(`| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |`);
        for (const [group, rows] of [
          ["Humans", lanes.actors.humans],
          ["Bots", lanes.actors.bots],
        ] as const) {
          for (const row of rows.slice(0, 5)) {
            const link = `[**${row.actor_login}**](https://github.com/${row.actor_login})`;
            lines.push(
              `| ${group} | ${link} | \`${row.score.toFixed(1)}\` | ${row.events.toLocaleString()} | ${row.repos.toLocaleString()} | ${row.pushes.toLocaleString()} | ${row.prs_opened.toLocaleString()} | ${row.prs_merged.toLocaleString()} |`
            );
          }
        }
        lines.push(``);
      }
      await copyToClipboard(lines.join("\n"), "markdown");
      setCopiedTickerMd(true);
      setTimeout(() => setCopiedTickerMd(false), 2000);
    } catch {
      setCopiedTickerMd(false);
    }
  }
  const drilldownRequest = useRef(0);
  const drilldownAbort = useRef<AbortController | undefined>(undefined);
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

  useEffect(() => () => drilldownAbort.current?.abort(), []);

  async function openRepo(repoName: string) {
    const requestId = drilldownRequest.current + 1;
    drilldownRequest.current = requestId;
    drilldownAbort.current?.abort();
    const controller = new AbortController();
    drilldownAbort.current = controller;
    setSelectedRepo(repoName);
    setLoadingRepo(repoName);
    setDrilldownError(undefined);
    try {
      const res = await fetch(`/api/repo-drilldown?repo=${encodeURIComponent(repoName)}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "repo drill-down failed");
      if (drilldownRequest.current !== requestId) return;
      setDrilldown(body as RepoDrilldownPayload);
    } catch (error) {
      if (controller.signal.aborted || drilldownRequest.current !== requestId) return;
      setDrilldown(undefined);
      setDrilldownError(error instanceof Error ? error.message : "repo drill-down failed");
    } finally {
      if (drilldownRequest.current === requestId) setLoadingRepo(undefined);
    }
  }

  return (
    <section className="ticker" aria-label="Breakout ticker">
      <div className="tk-head mono" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          📌 PINNED · BREAKOUT TICKER <span className="muted">{ingestToken ? "ticks with ingestion" : "refreshes 60s"}</span>
          <span className="muted">· tap any repo to render its live data</span>
        </div>
        <button
          type="button"
          className={`asset-copy-btn${copiedTickerMd ? " copied" : ""}`}
          onClick={handleCopyTickerMd}
          style={{ opacity: 1, position: "static" }}
          aria-label="Copy Breakout Ticker as Markdown"
        >
          {copiedTickerMd ? "Copied MD!" : "Copy Markdown"}
        </button>
      </div>
      <Lane title="NEW REPOS" cards={lanes.newRepos} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="TOP FORKED · 24H" cards={lanes.topForked} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="SHIPPING VELOCITY · 24H" cards={lanes.shippingVelocity} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="STAR BREAKOUTS" cards={lanes.starBreakouts} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="RISING STORIES" cards={lanes.risingStories} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      {lanes.actors && (
        <div className="tk-lane">
          <div className="tk-lane-title mono">PROLIFIC ACTORS · 24H</div>
          <div className="tk-scroll">
            <ActorLeaderboardCard humans={lanes.actors.humans} bots={lanes.actors.bots} />
          </div>
        </div>
      )}
      {(loadingRepo || drilldownError || drilldown) && (
        <div className="ticker-drilldown" aria-live="polite">
          {loadingRepo && <div className="agent-tool mono">rendering {loadingRepo} in background...</div>}
          {drilldownError && <div className="agent-fault mono" role="alert">! {drilldownError}</div>}
          {drilldown && <RenderedAnswer payload={drilldown} />}
        </div>
      )}
    </section>
  );
}
