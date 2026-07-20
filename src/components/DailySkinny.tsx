"use client";

import { useEffect, useMemo, useState } from "react";
import type { DigestCluster, DigestPayload, EvidenceLink } from "@/lib/render-payload";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";

const BAND_LABELS: Record<DigestCluster["band"], string> = {
  shipping: "SHIPPING",
  debated: "DEBATED",
  hype: "HYPE",
};

const VERDICT_COLOR: Record<string, string> = {
  ACCELERATING: "var(--cyan)",
  PEAKING: "var(--amber)",
  COOLING: "var(--muted)",
  DORMANT: "var(--muted)",
  BREAKOUT: "var(--mag)",
  DIVERGENT: "var(--mag)",
};

function ageLabel(freshAt: string | Date | number) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(freshAt).getTime()) / 1000));
  if (seconds < 90) return `data ${seconds}s old`;
  const minutes = Math.round(seconds / 60);
  return `data ${minutes}m old`;
}

function TakeLink({ take }: { take: EvidenceLink }) {
  return (
    <p>
      <a href={take.url} target="_blank" rel="noreferrer">
        {take.title}
      </a>
      {(take.score !== undefined || take.comments !== undefined) && (
        <span className="mono"> {take.score ?? 0} pts · {take.comments ?? 0} cmts</span>
      )}
    </p>
  );
}

function ClusterRow({ cluster }: { cluster: DigestCluster }) {
  const [open, setOpen] = useState(false);
  const [takes, setTakes] = useState(cluster.takes);
  const [loading, setLoading] = useState(false);
  const codeShare = 1 - cluster.talkShare;
  const sourceParts = [
    cluster.sources.hnThreads > 0 ? `${cluster.sources.hnThreads} HN threads` : "",
    cluster.sources.comments > 0 ? `${cluster.sources.comments} cmts` : "",
    cluster.sources.ghStars24h > 0 ? `${cluster.sources.ghStars24h.toLocaleString()} stars/24h` : "",
    cluster.sources.repos > 0 ? `${cluster.sources.repos} repos` : "",
  ].filter(Boolean);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || takes || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/digest/takes?subject=${encodeURIComponent(cluster.id)}`);
      if (res.ok) setTakes(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="skinny-row" data-band={cluster.band}>
      <div className="skinny-row-main">
        <span className="skinny-signal">
          <span className="skinny-verdict mono" style={{ color: VERDICT_COLOR[cluster.verdict] }}>
            {cluster.verdict}
          </span>
          <span className="skinny-spark"><Sparkline data={cluster.spark} color={VERDICT_COLOR[cluster.verdict]} w={86} h={24} /></span>
        </span>
        <span className="skinny-copy">
          <span className="skinny-title-line">
            <button className="skinny-subject" type="button" onClick={toggle} aria-expanded={open}>
              {cluster.subject}
            </button>
            <a href={cluster.links.hn} target="_blank" rel="noreferrer" className="evidence-link mono">HN</a>
            <a href={cluster.links.github} target="_blank" rel="noreferrer" className="evidence-link mono">GH</a>
          </span>
          <span className="skinny-text">{cluster.skinny}</span>
          <span className="skinny-sources mono">
            {sourceParts.length} sources ·{" "}
            <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.sources.hnThreads} HN threads</a>
            {" · "}{cluster.sources.comments} cmts{" · "}
            <a href={cluster.links.github} target="_blank" rel="noreferrer">{cluster.sources.ghStars24h.toLocaleString()} stars/24h · {cluster.sources.repos} repos</a>
          </span>
        </span>
        <span className="skinny-proof">
          <span className="skinny-share mono">
            <b>{Math.round(cluster.talkShare * 100)}% talk</b>
            <i>{Math.round(codeShare * 100)}% code</i>
          </span>
          <span className="skinny-meter" aria-hidden="true">
            <i style={{ width: `${Math.round(cluster.talkShare * 100)}%` }} />
          </span>
          <span className="skinny-source-chips mono">
            {sourceParts.slice(0, 3).map((part) => <em key={part}>{part}</em>)}
          </span>
        </span>
      </div>
      {open && (
        <div className="debate-map">
          <div>
            <div className="debate-label mono">AGREE</div>
            {loading && !takes ? <p>loading...</p> : (takes?.agree.length ? takes.agree.map((take) => <TakeLink key={take.url} take={take} />) : <p>no clear agreeing take</p>)}
          </div>
          <div>
            <div className="debate-label mono">DISPUTE</div>
            {loading && !takes ? <p>loading...</p> : (takes?.dispute.length ? takes.dispute.map((take) => <TakeLink key={take.url} take={take} />) : <p>no clear dispute</p>)}
          </div>
          <div>
            <div className="debate-label mono">OUTLIER</div>
            {takes?.outlier ? <TakeLink take={takes.outlier} /> : <p>{loading ? "loading..." : "tap a take to validate it"}</p>}
          </div>
        </div>
      )}
    </article>
  );
}

export function DailySkinny({ initial, ingestToken }: { initial: DigestPayload; ingestToken?: string }) {
  const digest = initial;
  const [fresh, setFresh] = useState("data 0s old");
  // Trigger.dev Realtime: the chip resets the moment an ingestion run lands.
  const { lastIngestAt, isIngesting } = useIngestPulse(ingestToken);
  const ingestKey = lastIngestAt?.getTime() ?? 0;

  useEffect(() => {
    const freshAt = ingestKey ? ingestKey : digest.generatedAt;
    setFresh(ageLabel(freshAt));
    const tick = setInterval(() => setFresh(ageLabel(freshAt)), 1000);
    return () => clearInterval(tick);
  }, [digest.generatedAt, ingestKey]);

  const bands = useMemo(
    () => (["shipping", "debated", "hype"] as const).map((band) => ({
      band,
      clusters: digest.clusters.filter((cluster) => cluster.band === band),
    })),
    [digest.clusters]
  );

  return (
    <main className="skinny-shell">
      <header className="skinny-masthead">
        <div>
          <p className="skinny-kicker mono">ATTENTION_TERMINAL</p>
          <h1>THE DAILY SKINNY</h1>
          <p className="skinny-meta mono">
            {new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(digest.generatedAt))}
            <span>{digest.clusters.length} things worth your attention</span>
            <span className="fresh-chip">{isIngesting ? "◉ ingesting · " : ""}{fresh}</span>
          </p>
        </div>
      </header>

      <section className="skinny-list" aria-label="Daily digest clusters">
        {bands.map(({ band, clusters }) => (
          <section key={band} className={`skinny-band band-${band}`}>
            <div className="band-rule mono">{BAND_LABELS[band]}</div>
            {clusters.length ? (
              clusters.map((cluster) => <ClusterRow key={cluster.id} cluster={cluster} />)
            ) : (
              <p className="empty-band mono">no clusters above the current floor</p>
            )}
          </section>
        ))}
      </section>
    </main>
  );
}
