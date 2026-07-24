"use client";

import { useEffect, useMemo, useState } from "react";
import { HnThreadInsightsSchema, type DigestCluster, type DigestPayload, type EvidenceLink, type HnThreadInsights } from "@/lib/render-payload";
import { Sparkline } from "./charts";
import { useIngestPulse } from "./useIngestPulse";
import { copyToClipboard, exportAssetAsMarkdown } from "@/lib/asset-export";

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

function hnAgeLabel(unixSeconds: number) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "age unavailable";

  const seconds = Math.max(0, Math.round(Date.now() / 1000 - unixSeconds));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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

function HnThreadPanel({ insights }: { insights: HnThreadInsights }) {
  const { evidence, themes } = insights;
  const depthCounts = new Map<number, number>();
  for (const reply of evidence.representativeReplies) {
    depthCounts.set(reply.depth, (depthCounts.get(reply.depth) ?? 0) + 1);
  }
  const depthRows = [...depthCounts.entries()].sort(([a], [b]) => a - b);
  const maxDepthCount = Math.max(1, ...depthRows.map(([, count]) => count));
  const partialLabel = evidence.completeness.state === "partial"
    ? `sampled · ${evidence.completeness.reason?.replaceAll("_", " ") ?? "partial"}`
    : "bounded sample";

  return (
    <section className="hn-thread-panel" aria-label="HN thread intelligence">
      <div className="hn-thread-head">
        <div>
          <div className="debate-label mono">HN THREAD INTELLIGENCE</div>
          <a href={evidence.story.url} target="_blank" rel="noreferrer" className="hn-thread-story">
            {evidence.story.title || "HN story"}
          </a>
        </div>
        <a href={evidence.story.url} target="_blank" rel="noreferrer" className="evidence-link mono">STORY</a>
      </div>
      <div className="hn-thread-meta mono" aria-label="HN thread metadata">
        <span>{evidence.story.score} story points</span>
        <span>{evidence.descendantsReported} reported descendants</span>
        <span>{evidence.commentsObserved} observed comments</span>
        <span>{evidence.topLevelRepliesObserved} top-level replies</span>
        <span>{hnAgeLabel(evidence.story.time)}</span>
        <span>max depth {evidence.depth.maxObserved}/{evidence.depth.limit}</span>
        <span className="hn-thread-partial">{partialLabel}</span>
      </div>
      <div className="hn-thread-grid">
        <div>
          <div className="debate-label mono">DEPTH PROFILE · OBSERVED</div>
          {depthRows.length ? (
            <ol className="hn-depth-list" aria-label="Observed representative replies by depth">
              {depthRows.map(([depth, count]) => (
                <li key={depth}>
                  <span>depth {depth}</span>
                  <span className="hn-depth-bar" aria-hidden="true"><i style={{ width: `${Math.max(8, Math.round((count / maxDepthCount) * 100))}%` }} /></span>
                  <b>{count}</b>
                </li>
              ))}
            </ol>
          ) : <p className="hn-thread-empty">No observed replies in the bounded sample.</p>}
        </div>
        <div>
          <div className="debate-label mono">COMMON THEMES · {themes.length}/5</div>
          {themes.length ? (
            <ul className="hn-theme-list" aria-label="Common HN discussion themes">
              {themes.map((theme) => (
                <li key={theme.label}>
                  <span className="hn-theme-label">{theme.label}</span>
                  <span className="mono hn-theme-stats">{theme.count} comments · {Math.round(theme.coverage * 100)}% · {Math.round(theme.confidence * 100)}% confidence</span>
                  <span className="hn-theme-links">
                    {theme.representativeCommentIds.map((id) => (
                      <a key={id} href={`https://news.ycombinator.com/item?id=${id}`} target="_blank" rel="noreferrer" aria-label={`Open HN evidence comment ${id}`}>#{id}</a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="hn-thread-empty">Not enough observed comments to explain themes.</p>}
        </div>
      </div>
      <div className="hn-replies">
        <div className="debate-label mono">REPRESENTATIVE REPLIES · {evidence.representativeReplies.length}</div>
        {evidence.representativeReplies.length ? (
          <ul aria-label="Representative HN replies">
            {evidence.representativeReplies.map((reply) => (
              <li key={reply.id}>
                <a href={reply.url} target="_blank" rel="noreferrer" className="mono">#{reply.id}</a>
                <span className="mono">d{reply.depth} · {reply.score} pts</span>
                <span>{reply.excerpt || "(empty comment)"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="hn-thread-empty">No representative replies available.</p>}
      </div>
    </section>
  );
}

function ClusterRow({ cluster }: { cluster: DigestCluster }) {
  const [open, setOpen] = useState(false);
  const [takes, setTakes] = useState(cluster.takes);
  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState<HnThreadInsights | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadUnavailable, setThreadUnavailable] = useState(false);
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
    if (!next) return;
    if (!takes && !loading) {
      setLoading(true);
      void fetch(`/api/digest/takes?subject=${encodeURIComponent(cluster.id)}`)
        .then(async (res) => { if (res.ok) setTakes(await res.json()); })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }
    if (!thread && !threadUnavailable && !threadLoading) {
      setThreadLoading(true);
      void fetch(`/api/digest/thread?subject=${encodeURIComponent(cluster.id)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("thread evidence unavailable");
          const parsed = HnThreadInsightsSchema.safeParse(await res.json());
          if (!parsed.success) throw new Error("malformed thread evidence");
          setThread(parsed.data);
        })
        .catch(() => setThreadUnavailable(true))
        .finally(() => setThreadLoading(false));
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
          <div className="debate-map-thread">
            {threadLoading ? <p>loading bounded thread sample...</p> : thread ? <HnThreadPanel insights={thread} /> : <p>{threadUnavailable ? "HN thread intelligence unavailable; the story and debate takes remain available." : "HN thread intelligence not loaded."}</p>}
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

  const [copiedMd, setCopiedMd] = useState(false);

  async function handleCopyMd() {
    try {
      const md = exportAssetAsMarkdown(digest);
      await copyToClipboard(md, "markdown");
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    } catch {
      setCopiedMd(false);
    }
  }

  return (
    <main className="skinny-shell">
      <header className="skinny-masthead">
        <div>
          <p className="skinny-kicker mono">ATTENTION_TERMINAL</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h1>THE DAILY SKINNY</h1>
            <button
              type="button"
              className={`asset-copy-btn${copiedMd ? " copied" : ""}`}
              onClick={handleCopyMd}
              style={{ opacity: 1, position: "static" }}
              aria-label="Copy Daily Skinny as Markdown"
            >
              {copiedMd ? "Copied MD!" : "Copy Markdown"}
            </button>
          </div>
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
