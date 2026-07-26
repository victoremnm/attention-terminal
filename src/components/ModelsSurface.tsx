"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SurfaceNav } from "@/components/SurfaceNav";
import { PieChart, HorizontalBarChart, Sparkline } from "@/components/charts";
import type {
  HfHeadlineRow,
  HfTopModelRow,
  HfTrendingModelRow,
  HfAuthorRow,
  HfPipelineTagRow,
  HfLibraryRow,
  HfScanKindRow,
  HfTagRow,
  HfModelDetail,
} from "@/lib/queries";

function ModelBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="chip models-badge" style={{ borderColor: color, color }}>
      {label}
    </span>
  );
}

function StatsCards({ headline }: { headline?: HfHeadlineRow }) {
  if (!headline) return null;
  return (
    <div className="models-stats-grid">
      <div className="models-stat-card">
        <span className="models-stat-value">{Number(headline.total_models).toLocaleString()}</span>
        <span className="models-stat-label mono">MODELS</span>
      </div>
      <div className="models-stat-card">
        <span className="models-stat-value">{Number(headline.total_downloads) >= 1_000_000 ? `${(Number(headline.total_downloads) / 1_000_000).toFixed(1)}M` : Number(headline.total_downloads).toLocaleString()}</span>
        <span className="models-stat-label mono">DOWNLOADS</span>
      </div>
      <div className="models-stat-card">
        <span className="models-stat-value">{Number(headline.total_likes).toLocaleString()}</span>
        <span className="models-stat-label mono">LIKES</span>
      </div>
      <div className="models-stat-card">
        <span className="models-stat-value">{headline.scan_kinds_covered}</span>
        <span className="models-stat-label mono">SCAN_KINDS</span>
      </div>
    </div>
  );
}

function ModelLeaderboardRow({
  row,
  rank,
  onSelect,
}: {
  row: HfTopModelRow;
  rank: number;
  onSelect: (model: HfTopModelRow, el: HTMLButtonElement) => void;
}) {
  const dl = Number(row.downloads);
  const barW = Math.min(100, (dl / 50_000_000) * 100);
  return (
    <button
      type="button"
      className="models-leaderboard-row"
      onClick={(e) => onSelect(row, e.currentTarget)}
      aria-label={`Inspect ${row.model_id}`}
    >
      <span className="mono models-rank">{rank}</span>
      <span className="mono models-name">{row.model_id}</span>
      <span className="mono models-author">{row.author}</span>
      {row.pipeline_tag && <ModelBadge label={row.pipeline_tag} color="var(--cyan)" />}
      {row.library_name && <ModelBadge label={row.library_name} color="var(--blue)" />}
      {row.is_gated === "1" && <ModelBadge label="gated" color="var(--amber)" />}
      {row.is_private === "1" && <ModelBadge label="private" color="var(--mag)" />}
      <div className="models-leaderbar-track">
        <div className="models-leaderbar-fill" style={{ width: `${barW}%` }} />
      </div>
      <span className="mono models-dl">{dl >= 1_000_000 ? `${(dl / 1_000_000).toFixed(1)}M` : dl.toLocaleString()}</span>
      <span className="mono models-likes">{Number(row.likes).toLocaleString()}</span>
    </button>
  );
}

function TrendingRow({ row }: { row: HfTrendingModelRow }) {
  const delta = Number(row.downloads_delta);
  return (
    <div className="models-trending-row">
      <span className="mono models-trending-name">{row.model_id}</span>
      <span className="mono models-trending-author">{row.author}</span>
      <span className="mono models-trending-now">{Number(row.downloads_now).toLocaleString()}</span>
      <span className={`mono models-trending-delta ${delta >= 0 ? "delta-up" : "delta-down"}`}>
        {delta >= 0 ? "+" : ""}{delta.toLocaleString()}
      </span>
    </div>
  );
}

interface ModelsSurfaceProps {
  headline?: HfHeadlineRow;
  topModels: HfTopModelRow[];
  trendingModels: HfTrendingModelRow[];
  authorLeaderboard: HfAuthorRow[];
  pipelineTags: HfPipelineTagRow[];
  libraryDistribution: HfLibraryRow[];
  scanKindBreakdown: HfScanKindRow[];
  tagFrequency: HfTagRow[];
}

export function ModelsSurface({
  headline,
  topModels,
  trendingModels,
  authorLeaderboard,
  pipelineTags,
  libraryDistribution,
  scanKindBreakdown,
  tagFrequency,
}: ModelsSurfaceProps) {
  const [selected, setSelected] = useState<HfTopModelRow | undefined>();
  const [detail, setDetail] = useState<HfModelDetail | undefined>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sort, setSort] = useState<"downloads" | "likes" | "created_at">("downloads");
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef(0);

  function getSortValue(m: HfTopModelRow): number {
    if (sort === "created_at") return new Date(m.created_at || 0).getTime();
    return Number(m[sort]);
  }
  const sortedModels = [...topModels].sort((a, b) => {
    return getSortValue(b) - getSortValue(a);
  });

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeDrawer();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const openDrawer = useCallback(async (model: HfTopModelRow, _opener: HTMLButtonElement) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSelected(model);
    setDetail(undefined);
    setError(undefined);
    setLoading(true);
    setOpen(true);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(model.model_id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "model detail fetch failed");
      if (requestRef.current !== requestId) return;
      setDetail(body.data as HfModelDetail);
    } catch (e) {
      if (requestRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : "model detail fetch failed");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  function closeDrawer() {
    setOpen(false);
    openerRef.current?.focus();
  }

  const pipelineItems = pipelineTags.map((r) => ({
    label: r.pipeline_tag,
    value: Number(r.model_count),
  }));

  const libraryItems = libraryDistribution.map((r) => ({
    label: r.library_name,
    value: Number(r.model_count),
  }));

  const authorItems = authorLeaderboard.map((r) => ({
    label: r.author,
    value: Number(r.total_downloads),
  }));

  const tagItems = tagFrequency.map((r) => ({
    label: r.tag,
    value: Number(r.model_count),
  }));

  const scanKindItems = scanKindBreakdown.map((r) => ({
    category: r.scan_kind,
    segments: [
      { key: "downloads", label: "Downloads", value: Number(r.total_downloads), color: "var(--cyan)" },
    ],
  }));

  return (
    <>
      <SurfaceNav active="models" />
      <main className="models-shell">
        <header className="models-head">
          <p className="skinny-kicker mono">HUGGING_FACE</p>
          <h1>Models</h1>
          <p className="models-copy">
            Curated Hugging Face model snapshots from 10 hourly scan kinds.
            Click a row for model detail and scan history.
          </p>
        </header>

        <StatsCards headline={headline} />

        {trendingModels.length > 0 && (
          <section className="models-section">
            <h2 className="models-section-title mono">TRENDING_1H</h2>
            <div className="models-trending-list">
              {trendingModels.map((row, i) => (
                <TrendingRow key={row.model_id} row={row} />
              ))}
            </div>
          </section>
        )}

        <section className="models-section">
          <h2 className="models-section-title mono">
            LEADERBOARD
            <span className="models-sort-control">
              sort:
              <select
                className="models-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as "downloads" | "likes" | "created_at")}
              >
                <option value="downloads">downloads</option>
                <option value="likes">likes</option>
                <option value="created_at">newest</option>
              </select>
            </span>
          </h2>
          <div className="models-leaderboard">
            {sortedModels.length === 0 && (
              <p className="models-empty mono">No models loaded yet. The HF ingestion cron runs every hour.</p>
            )}
            {sortedModels.slice(0, 100).map((row, i) => (
              <ModelLeaderboardRow key={row.model_id} row={row} rank={i + 1} onSelect={openDrawer} />
            ))}
          </div>
        </section>

        <div className="models-charts-row">
          {pipelineItems.length > 0 && (
            <section className="models-section">
              <PieChart items={pipelineItems} title="Pipeline Tags" />
            </section>
          )}
          {libraryItems.length > 0 && (
            <section className="models-section">
              <HorizontalBarChart items={libraryItems} title="Libraries" />
            </section>
          )}
        </div>

        <div className="models-charts-row">
          {authorItems.length > 0 && (
            <section className="models-section">
              <HorizontalBarChart items={authorItems} title="Top Authors by Downloads" />
            </section>
          )}
          {tagItems.length > 0 && (
            <section className="models-section">
              <HorizontalBarChart items={tagItems} title="Top Tags" />
            </section>
          )}
        </div>

        {scanKindItems.length > 0 && (
          <section className="models-section">
            <h2 className="models-section-title mono">SCAN_KIND_BREAKDOWN</h2>
            <div className="models-scan-grid">
              {scanKindBreakdown.map((row) => (
                <div key={row.scan_kind} className="models-scan-card">
                  <span className="mono models-scan-kind">{row.scan_kind}</span>
                  <span className="mono models-scan-count">{Number(row.model_count)} models</span>
                  <span className="mono models-scan-dl">{Number(row.total_downloads) >= 1_000_000 ? `${(Number(row.total_downloads) / 1_000_000).toFixed(1)}M` : Number(row.total_downloads).toLocaleString()} downloads</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {open && (
        <>
          <div className="models-detail-backdrop" aria-hidden="true" onClick={closeDrawer} />
          <aside
            className="models-detail-drawer"
            role="dialog"
            aria-modal="false"
            aria-labelledby="models-detail-title"
          >
            <header className="models-detail-head">
              <div>
                <p id="models-detail-title" className="mono kicker">MODEL DETAILS</p>
                {selected && (
                  <p className="models-detail-id mono">
                    {selected.pipeline_tag && (
                      <ModelBadge label={selected.pipeline_tag} color="var(--cyan)" />
                    )}{" "}
                    {selected.model_id}
                  </p>
                )}
              </div>
              <button
                ref={closeRef}
                type="button"
                className="models-detail-close chip"
                onClick={closeDrawer}
                aria-label="Close model details"
              >
                Close
              </button>
            </header>
            <div className="models-detail-body" aria-live="polite">
              {loading && <div className="agent-tool mono">loading model details...</div>}
              {error && <div className="agent-fault mono" role="alert">! {error}</div>}
              {detail && (
                <div className="models-detail-info">
                  {detail.author && (
                    <div className="models-detail-field">
                      <span className="mono muted">Author</span>
                      <span>{detail.author}</span>
                    </div>
                  )}
                  {detail.library_name && (
                    <div className="models-detail-field">
                      <span className="mono muted">Library</span>
                      <span>{detail.library_name}</span>
                    </div>
                  )}
                  <div className="models-detail-field">
                    <span className="mono muted">Downloads</span>
                    <span className="mono">{Number(detail.downloads).toLocaleString()}</span>
                  </div>
                  <div className="models-detail-field">
                    <span className="mono muted">Likes</span>
                    <span className="mono">{Number(detail.likes).toLocaleString()}</span>
                  </div>
                  {detail.is_gated === "1" && (
                    <div className="models-detail-field">
                      <span className="mono muted">Gated</span>
                      <ModelBadge label="yes" color="var(--amber)" />
                    </div>
                  )}
                  {detail.is_private === "1" && (
                    <div className="models-detail-field">
                      <span className="mono muted">Private</span>
                      <ModelBadge label="yes" color="var(--mag)" />
                    </div>
                  )}
                  <div className="models-detail-field">
                    <span className="mono muted">HF Link</span>
                    <a
                      href={`https://huggingface.co/${detail.model_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="models-detail-link mono"
                    >
                      {detail.model_id}
                    </a>
                  </div>
                  {detail.tags && detail.tags.length > 0 && (
                    <div className="models-detail-field">
                      <span className="mono muted">Tags</span>
                      <div className="models-detail-tags">
                        {detail.tags.filter(Boolean).slice(0, 10).map((t: string) => (
                          <span key={t} className="chip models-badge" style={{ borderColor: "var(--muted)", color: "var(--muted)", fontSize: "10px" }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.scan_history && detail.scan_history.length > 0 && (
                    <div className="models-detail-field">
                      <span className="mono muted">Downloads (last 24 scans)</span>
                      <Sparkline
                        data={detail.scan_history.map((s: { downloads: string }) => Number(s.downloads)).reverse()}
                        color="var(--cyan)"
                        w={240}
                        h={40}
                        label="Download history"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
