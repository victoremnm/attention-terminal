import { SurfaceNav } from "@/components/SurfaceNav";
import { hnStoryFeed, type HNStoryRow } from "@/lib/queries";

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

function StoryCard({ row }: { row: HNStoryRow }) {
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
    </div>
  );
}

export async function HNStoryStream() {
  const stories = await hnStoryFeed(6, 50);

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
              <StoryCard key={row.id} row={row} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
