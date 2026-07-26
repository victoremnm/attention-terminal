import Link from "next/link";

export function SurfaceNav({
  active,
}: {
  active: "home" | "skinny" | "stories" | "events" | "models" | "trending" | "chat" | "analysis" | "deck";
}) {
  return (
    <nav className="surface-nav mono" aria-label="Attention Terminal surfaces">
      <Link href="/" aria-current={active === "home" ? "page" : undefined}>
        Live Feed
      </Link>
      <Link href="/skinny" aria-current={active === "skinny" ? "page" : undefined}>
        Daily Skinny
      </Link>
      <Link href="/stories" aria-current={active === "stories" ? "page" : undefined}>
        Stories
      </Link>
      <Link href="/events" aria-current={active === "events" ? "page" : undefined}>
        Events
      </Link>
      <Link href="/models" aria-current={active === "models" ? "page" : undefined}>
        Models
      </Link>
      <Link href="/trending" aria-current={active === "trending" ? "page" : undefined}>
        Repo Rankings
      </Link>
      <Link href="/chat" aria-current={active === "chat" ? "page" : undefined}>
        Chat
      </Link>
      <Link href="/analysis" aria-current={active === "analysis" ? "page" : undefined}>
        Analysis
      </Link>
      <Link href="/deck" aria-current={active === "deck" ? "page" : undefined}>
        Deck
      </Link>
    </nav>
  );
}
