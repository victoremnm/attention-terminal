import Link from "next/link";

export function SurfaceNav({ active }: { active: "skinny" | "trending" | "deck" }) {
  return (
    <nav className="surface-nav mono" aria-label="Attention Terminal surfaces">
      <Link href="/trending" aria-current={active === "trending" ? "page" : undefined}>
        Trending
      </Link>
      <Link href="/skinny" aria-current={active === "skinny" ? "page" : undefined}>
        Daily Skinny
      </Link>
      <Link href="/deck" aria-current={active === "deck" ? "page" : undefined}>
        Deck
      </Link>
    </nav>
  );
}
