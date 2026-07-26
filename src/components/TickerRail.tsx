"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TickerCard, TickerLanes, RepoLookupRow } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";
import { copyToClipboard } from "@/lib/asset-export";

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="miter" className={className} aria-hidden="true">
      <rect x="2" y="2" width="14" height="14" rx="1" />
      <polygon points="22 22 8 22 8 16 16 16 16 8 22 8 22 22" />
    </svg>
  );
}

function Card({
  card,
  state,
  onOpenRepo,
}: {
  card: TickerCard;
  state?: "loading" | "selected";
  onOpenRepo: (repoName: string, opener: HTMLButtonElement) => void;
}) {
  const [copied, setCopied] = useState(false);
  const stats = card.stats?.filter((stat) => stat.value !== "0").slice(0, 6) ?? [];
  const actionLabel = state === "loading" ? "loading details..." : state === "selected" ? "view details" : undefined;

  async function handleCopyCard(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const link = card.href ? `[**${card.name}**](${card.href})` : `**${card.name}**`;
      const md = `| Name | Metric | Delta |\n| :--- | :--- | :--- |\n| ${link} | \`${card.metric}\` | ${card.delta ?? "-"} |`;
      await copyToClipboard(md, "markdown");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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
          aria-label={`Open live ClickHouse details for ${card.repoName}`}
          title="Open this repo's details"
          onClick={(event) => onOpenRepo(card.repoName!, event.currentTarget)}
        >
          {inner}
          {actionLabel && <span className="tk-action mono">{actionLabel}</span>}
        </button>
        <button
          type="button"
          className={`tk-card-copy${copied ? " copied" : ""}`}
          onClick={handleCopyCard}
          aria-label={`Copy Markdown for ${card.name}`}
          title="Copy Markdown for this repo"
        >
          <CopyIcon />
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
  onOpenRepo: (repoName: string, opener: HTMLButtonElement) => void;
}) {
  const [copiedLane, setCopiedLane] = useState(false);

  async function handleCopyLane(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const lines = [
        `#### ${title}`,
        `| Name | Metric | Delta |`,
        `| :--- | :--- | :--- |`,
      ];
      for (const c of cards) {
        const link = c.href ? `[**${c.name}**](${c.href})` : `**${c.name}**`;
        lines.push(`| ${link} | \`${c.metric}\` | ${c.delta ?? "-"} |`);
      }
      await copyToClipboard(lines.join("\n"), "markdown");
      setCopiedLane(true);
      setTimeout(() => setCopiedLane(false), 2000);
    } catch {
      setCopiedLane(false);
    }
  }

  return (
    <div className="tk-lane">
      <div className="tk-lane-title mono">
        <span>{title}</span>
        <button
          type="button"
          className={`tk-lane-copy${copiedLane ? " copied" : ""}`}
          onClick={handleCopyLane}
          aria-label={`Copy ${title} lane as Markdown`}
          title={`Copy ${title} lane as Markdown`}
        >
          <CopyIcon />
          <span>{copiedLane ? "Copied" : "MD"}</span>
        </button>
      </div>
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
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [loadingRepo, setLoadingRepo] = useState<string | undefined>();
  const [drilldownError, setDrilldownError] = useState<string | undefined>();
  const [copiedTickerMd, setCopiedTickerMd] = useState(false);
  const drilldownCloseRef = useRef<HTMLButtonElement>(null);
  const drilldownOpenerRef = useRef<HTMLButtonElement | null>(null);

  async function handleCopyTickerMd() {
    try {
      const lines: string[] = [`### BREAKOUT TICKER`, ``];
      const laneConfigs = [
        { key: "newRepos", title: "NEW REPOS 24H" },
        { key: "topForked", title: "FORKED 24H" },
        { key: "shippingVelocity", title: "SHIPPING VELOCITY" },
        { key: "starBreakouts", title: "STAR BREAKOUTS" },

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

      await copyToClipboard(lines.join("\n"), "markdown");
      setCopiedTickerMd(true);
      setTimeout(() => setCopiedTickerMd(false), 2000);
    } catch {
      setCopiedTickerMd(false);
    }
  }
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RepoLookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const searchAbort = useRef<AbortController | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback(async (q: string) => {
    searchAbort.current?.abort();
    if (!q.trim()) { setSearchResults([]); setSearching(false); return; }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    try {
      const res = await fetch(`/api/repo-lookup?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!res.ok) return;
      const body = await res.json();
      if (!controller.signal.aborted) {
        setSearchResults(body.rows ?? []);
      }
    } catch {
      if (!controller.signal.aborted) setSearchResults([]);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults([]); setSearching(false); return; }
    searchTimer.current = setTimeout(() => doSearch(searchQuery), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, doSearch]);

  useEffect(() => () => searchAbort.current?.abort(), []);

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

  useEffect(() => {
    if (!drilldownOpen) return;
    drilldownCloseRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeDrilldown();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drilldownOpen]);

  async function openRepo(repoName: string, opener: HTMLButtonElement) {
    const requestId = drilldownRequest.current + 1;
    drilldownRequest.current = requestId;
    drilldownAbort.current?.abort();
    const controller = new AbortController();
    drilldownAbort.current = controller;
    drilldownOpenerRef.current = opener;
    setDrilldownOpen(true);
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

  function closeDrilldown() {
    setDrilldownOpen(false);
    drilldownOpenerRef.current?.focus();
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
      <div className="tk-repo-search">
        <input
          type="search"
          className="tk-search-input mono"
          placeholder="Find repo by name or owner…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search repositories"
        />
        {searching && <span className="tk-search-spinner mono">searching…</span>}
      </div>
      {searchResults.length > 0 && (
        <Lane
          title="SEARCH RESULTS"
          cards={searchResults.map((r) => ({
            kicker: r.match_type,
            name: r.repo_name,
            metric: r.language,
            stats: [{ label: "stars", value: r.github_stars }],
            repoName: r.repo_name,
          } satisfies TickerCard))}
          selectedRepo={selectedRepo}
          loadingRepo={loadingRepo}
          onOpenRepo={openRepo}
        />
      )}
      <Lane title="NEW REPOS" cards={lanes.newRepos} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="TOP FORKED · 24H" cards={lanes.topForked} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="SHIPPING VELOCITY · 24H" cards={lanes.shippingVelocity} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      <Lane title="STAR BREAKOUTS" cards={lanes.starBreakouts} selectedRepo={selectedRepo} loadingRepo={loadingRepo} onOpenRepo={openRepo} />
      {drilldownOpen && (
        <>
          <div className="ticker-drilldown-backdrop" aria-hidden="true" />
          <aside
            className="ticker-drilldown-drawer"
            role="dialog"
            aria-modal="false"
            aria-labelledby="ticker-drilldown-title"
          >
            <header className="ticker-drilldown-head">
              <div>
                <p id="ticker-drilldown-title" className="mono kicker">REPO DETAILS</p>
                <p className="ticker-drilldown-repo mono">{selectedRepo}</p>
              </div>
              <button
                ref={drilldownCloseRef}
                type="button"
                className="ticker-drilldown-close chip"
                onClick={closeDrilldown}
                aria-label="Close repository details"
              >
                Close
              </button>
            </header>
            <div className="ticker-drilldown-body" aria-live="polite">
              {loadingRepo && <div className="agent-tool mono">loading {loadingRepo} details...</div>}
              {drilldownError && <div className="agent-fault mono" role="alert">! {drilldownError}</div>}
              {drilldown && <RenderedAnswer payload={drilldown} />}
            </div>
          </aside>
        </>
      )}
    </section>
  );
}
