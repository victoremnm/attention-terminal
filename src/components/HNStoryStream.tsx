import { SurfaceNav } from "@/components/SurfaceNav";
import { hnStoryStream, type HNStoryRow, type HNReplyRow } from "@/lib/queries";

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch { return null; }
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

function sanitizeExcerpt(text: string | null | undefined, maxLength = 200) {
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

function ReplyPreview({ reply }: { reply: HNReplyRow }) {
  const ts = new Date(Number(reply.time) * 1000);
  const timeStr = ts.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="hn-reply-preview">
      <span className="hn-reply-author mono">{reply.by}</span>
      <span className="hn-reply-score mono">{reply.score} pts</span>
      <span className="hn-reply-text">{sanitizeExcerpt(reply.text, 160)}</span>
      <span className="hn-reply-time mono">{timeStr}</span>
    </div>
  );
}

function StoryCard({ row, replies }: { row: HNStoryRow; replies: HNReplyRow[] }) {
  const ts = new Date(Number(row.time) * 1000);
  const timeStr = ts.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const score = Number(row.score);
  const velocity = Number(row.velocity);
  const desc = Number(row.descendants);
  const domain = safeDomain(row.url);

  return (
    <div className="hn-story-card">
      <div className="hn-story-header">
        <a
          href={row.url || `https://news.ycombinator.com/item?id=${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hn-story-title"
        >
          {row.title}
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
        <span className="hn-story-author">by {row.by}</span>
        <span className="hn-story-time">{timeStr}</span>
      </div>
      {replies.length > 0 && (
        <div className="hn-replies">
          {replies.slice(0, 5).map((reply) => (
            <ReplyPreview key={reply.id} reply={reply} />
          ))}
        </div>
      )}
    </div>
  );
}

export async function HNStoryStream() {
  const { stories, replies } = await hnStoryStream(6, 50);
  const repliesByStory = new Map<string, HNReplyRow[]>();
  for (const reply of replies) {
    const existing = repliesByStory.get(reply.story_id) ?? [];
    existing.push(reply);
    repliesByStory.set(reply.story_id, existing);
  }

  return (
    <>
      <SurfaceNav active="stories" />
      <main className="hn-shell">
        <header className="hn-head">
          <p className="skinny-kicker mono">HACKER_NEWS</p>
          <h1>Story Stream</h1>
          <p className="hn-copy">
            Active HN stories ranked by points velocity over the last 6 hours.
            Ingested live from the Firebase API every minute.
          </p>
        </header>

        <section className="hn-section">
          <div className="hn-stream">
            {stories.data.length === 0 && (
              <p className="hn-empty mono">No stories in the current window.</p>
            )}
            {stories.data.map((row) => (
              <StoryCard key={row.id} row={row} replies={repliesByStory.get(row.id) ?? []} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
