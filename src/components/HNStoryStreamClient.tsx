"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIngestPulse } from "@/components/useIngestPulse";
import type { HNReplyRow, HNStoryRow, HNStreamResult } from "@/lib/queries";

const REFRESH_INTERVAL_MS = 60_000;

export function mergeHNStoryStream(current: HNStreamResult, incoming: HNStreamResult): HNStreamResult {
  const stories = new Map(incoming.stories.data.map((story) => [story.id, story]));
  const replies = new Map(incoming.replies.map((reply) => [`${reply.story_id}:${reply.id}`, reply]));
  return {
    stories: { ...incoming.stories, data: [...stories.values()] },
    replies: [...replies.values()],
  };
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sanitizeExcerpt(text: string | null | undefined, maxLength = 200) {
  if (!text) return "";
  const plain = text
    .replace(/<\/?(script|style)[^>]*>[\s\S]*?<\/?\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) =>
      String.fromCodePoint(Number(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : code)),
    )
    .replace(/&(?:amp|lt|gt|quot|#39);/gi, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    })[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}

function relativeAge(unixSeconds: string) {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds));
  if (ageSeconds < 3600) return `${Math.max(1, Math.floor(ageSeconds / 60))}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

function HNLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <a
      href={`https://news.ycombinator.com/item?id=${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hn-link"
    >
      {children}
    </a>
  );
}

function ReplyPreview({ reply }: { reply: HNReplyRow }) {
  return (
    <div className="hn-reply-preview">
      <span className="hn-reply-author mono">{reply.by}</span>
      <span className="hn-reply-score mono">{reply.score} pts</span>
      <span className="hn-reply-text">{sanitizeExcerpt(reply.text, 160)}</span>
      <span className="hn-reply-time mono">{relativeAge(reply.time)}</span>
    </div>
  );
}

function StoryCard({ row, replies, compact = false }: { row: HNStoryRow; replies: HNReplyRow[]; compact?: boolean }) {
  const score = Number(row.score);
  const velocity = Number(row.velocity);
  const desc = Number(row.descendants);
  const domain = safeDomain(row.url);

  return (
    <article className={`hn-story-card${compact ? " hn-story-card-compact" : ""}`}>
      <div className="hn-story-header">
        <a
          href={row.url || `https://news.ycombinator.com/item?id=${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hn-story-title"
        >
          {row.title || "Untitled Hacker News story"}
        </a>
        {domain && <span className="hn-story-domain mono">{domain}</span>}
      </div>
      <div className="hn-story-meta mono">
        <span className="hn-story-score">{score} pts</span>
        <span className="hn-story-velocity" style={{ opacity: Math.min(1, velocity / 10 + 0.3) }}>
          {velocity.toFixed(1)} pts/hr
        </span>
        <HNLink id={row.id}>
          {desc} comment{desc === 1 ? "" : "s"}
        </HNLink>
        <span className="hn-story-author">by {row.by || "unknown"}</span>
        <span className="hn-story-time">{relativeAge(row.time)}</span>
      </div>
      {!compact && replies.length > 0 && (
        <div className="hn-replies">
          {replies.slice(0, 5).map((reply) => <ReplyPreview key={reply.id} reply={reply} />)}
        </div>
      )}
    </article>
  );
}

function useHNStoryStream(
  initial: HNStreamResult,
  ingestToken?: string,
  includeReplies = true,
  initialError?: string | null,
) {
  const [stream, setStream] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  // Keep the server-rendered and first client-rendered markup identical. The
  // localized timestamp is populated by the mount effect below.
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { lastIngestAt, error: realtimeError } = useIngestPulse(ingestToken);
  const ingestKey = lastIngestAt?.getTime() ?? 0;

  const refresh = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/stories?hours=6&limit=50&replies=${includeReplies ? "1" : "0"}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      const body = await response.json() as HNStreamResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "story refresh failed");
      if (requestRef.current !== requestId) return;
      setStream((current) => mergeHNStoryStream(current, body));
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "story refresh failed");
    } finally {
      if (requestRef.current === requestId) setRefreshing(false);
    }
  }, [includeReplies]);

  useEffect(() => {
    if (!initialError) setUpdatedAt(new Date());
    if (ingestKey) void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [ingestKey, initialError, refresh]);

  return {
    stream,
    refreshing,
    error,
    updatedAt,
    usingPollingFallback: Boolean(realtimeError || !ingestToken),
    refresh,
  };
}

function StreamStatus({
  updatedAt,
  refreshing,
  error,
  usingPollingFallback,
  onRefresh,
}: {
  updatedAt: Date | null;
  refreshing: boolean;
  error: string | null;
  usingPollingFallback: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="hn-stream-status mono" aria-live="polite">
      <span className={error ? "hn-status-stale" : "hn-status-live"}>
        {error ? "STALE" : usingPollingFallback ? "POLLING" : "LIVE"}
      </span>
      <span>
        {updatedAt
          ? `updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "waiting for update"}
      </span>
      {error && <span title={error}>refresh unavailable</span>}
      <button type="button" className="hn-refresh-button" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "refreshing…" : "refresh"}
      </button>
    </div>
  );
}

export function HNStoryTicker({
  initial,
  initialError,
  ingestToken,
}: {
  initial: HNStreamResult;
  initialError?: string | null;
  ingestToken?: string;
}) {
  const { stream, refreshing, error, updatedAt, usingPollingFallback, refresh } = useHNStoryStream(
    initial,
    ingestToken,
    false,
    initialError,
  );
  const repliesByStory = useMemo(() => {
    const result = new Map<string, HNReplyRow[]>();
    for (const reply of stream.replies) {
      const existing = result.get(reply.story_id) ?? [];
      existing.push(reply);
      result.set(reply.story_id, existing);
    }
    return result;
  }, [stream.replies]);

  return (
    <section className="hn-home-lane" aria-label="Hacker News story ticker">
      <header className="hn-home-head">
        <div>
          <p className="skinny-kicker mono">HACKER_NEWS · RISING STORIES</p>
          <h2>What’s being discussed now</h2>
        </div>
        <a className="hn-story-more mono" href="/stories">View all stories →</a>
      </header>
      <StreamStatus updatedAt={updatedAt} refreshing={refreshing} error={error} usingPollingFallback={usingPollingFallback} onRefresh={() => void refresh()} />
      <div className="hn-home-grid">
        {stream.stories.data.slice(0, 8).map((story) => (
          <StoryCard key={story.id} row={story} replies={repliesByStory.get(story.id) ?? []} compact />
        ))}
        {stream.stories.data.length === 0 && <p className="hn-empty mono">No active stories in the current window.</p>}
      </div>
    </section>
  );
}

export function HNStoryStreamClient({
  initial,
  initialError,
  ingestToken,
}: {
  initial: HNStreamResult;
  initialError?: string | null;
  ingestToken?: string;
}) {
  const { stream, refreshing, error, updatedAt, usingPollingFallback, refresh } = useHNStoryStream(
    initial,
    ingestToken,
    true,
    initialError,
  );
  const repliesByStory = useMemo(() => {
    const result = new Map<string, HNReplyRow[]>();
    for (const reply of stream.replies) {
      const existing = result.get(reply.story_id) ?? [];
      existing.push(reply);
      result.set(reply.story_id, existing);
    }
    return result;
  }, [stream.replies]);

  return (
    <main className="hn-shell">
      <header className="hn-head">
        <p className="skinny-kicker mono">HACKER_NEWS</p>
        <h1>Story Stream</h1>
        <p className="hn-copy">
          Active HN stories ranked by points velocity over the last 6 hours.
          Ingested from the Firebase API every minute.
        </p>
        <StreamStatus updatedAt={updatedAt} refreshing={refreshing} error={error} usingPollingFallback={usingPollingFallback} onRefresh={() => void refresh()} />
      </header>

      <section className="hn-section">
        <div className="hn-stream">
          {stream.stories.data.length === 0 && (
            <p className="hn-empty mono">No stories in the current window.</p>
          )}
          {stream.stories.data.map((row) => (
            <StoryCard key={row.id} row={row} replies={repliesByStory.get(row.id) ?? []} />
          ))}
        </div>
      </section>
    </main>
  );
}
