"use client";

import { useEffect, useMemo, useState } from "react";
import type { DigestCluster, DigestPayload, EvidenceLink } from "@/lib/render-payload";
import { Sparkline } from "./charts";

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

function ageLabel(generatedAt: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000));
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
    <article className="skinny-row">
      <div className="skinny-row-main">
        <span className="skinny-verdict mono" style={{ color: VERDICT_COLOR[cluster.verdict] }}>
          {cluster.verdict}
        </span>
        <span className="skinny-spark"><Sparkline data={cluster.spark} color={VERDICT_COLOR[cluster.verdict]} w={86} h={24} /></span>
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
            {[
              `${cluster.sources.hnThreads} HN threads`,
              `${cluster.sources.comments} cmts`,
              `${cluster.sources.ghStars24h.toLocaleString()} stars/24h`,
              `${cluster.sources.repos} repos`,
            ].filter((part) => !part.startsWith("0 ")).length} sources ·{" "}
            <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.sources.hnThreads} HN threads</a>
            {" · "}{cluster.sources.comments} cmts{" · "}
            <a href={cluster.links.github} target="_blank" rel="noreferrer">{cluster.sources.ghStars24h.toLocaleString()} stars/24h · {cluster.sources.repos} repos</a>
          </span>
        </span>
        <span className="skinny-share mono">
          <b>{Math.round(cluster.talkShare * 100)}% talk</b>
          <i>{Math.round(codeShare * 100)}% code</i>
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

export function DailySkinny({ initial }: { initial: DigestPayload }) {
  const [digest, setDigest] = useState(initial);
  const [noiseFloor, setNoiseFloor] = useState(initial.noiseFloor);
  const [fresh, setFresh] = useState("data 0s old");

  useEffect(() => {
    const tick = setInterval(() => setFresh(ageLabel(digest.generatedAt)), 1000);
    return () => clearInterval(tick);
  }, [digest.generatedAt]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/digest?noiseFloor=${noiseFloor.toFixed(2)}`);
      if (res.ok) setDigest(await res.json());
    }, 350);
    return () => clearTimeout(handle);
  }, [noiseFloor]);

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
            <span className="fresh-chip">{fresh}</span>
          </p>
        </div>
        <label className="noise-control mono">
          <span>buzz</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={noiseFloor}
            onChange={(event) => setNoiseFloor(Number(event.target.value))}
            aria-label="Noise floor"
          />
          <span>confirmed</span>
          <b>{noiseFloor.toFixed(2)}</b>
        </label>
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
