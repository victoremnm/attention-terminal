import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-static";

const DOCS_ROOT = path.join(process.cwd(), "docs");

type DocEntry = { href: string; label: string };

async function walkDocs(dir: string, base: string, acc: DocEntry[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      await walkDocs(full, base, acc);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const href = `/docs/${rel.replace(/\.md$/, "").split(path.sep).join("/")}`;
      const label = rel.replace(/\.md$/, "");
      acc.push({ href, label });
    }
  }
}

async function listDocs(): Promise<DocEntry[]> {
  const acc: DocEntry[] = [];
  try {
    await walkDocs(DOCS_ROOT, DOCS_ROOT, acc);
  } catch {
    /* docs root missing */
  }
  acc.sort((a, b) => a.label.localeCompare(b.label));
  return acc;
}

export const metadata: Metadata = {
  title: "Docs · Attention Terminal",
  description: "Rendered markdown documentation for the Attention Terminal.",
};

export default async function DocsIndexPage() {
  const docs = await listDocs();
  return (
    <main className="docs-page">
      <div className="docs-page-inner">
        <header className="docs-page-header">
          <Link href="/" className="docs-back-link">
            ← feed
          </Link>
          <h1>Docs</h1>
          <p className="docs-page-lede">
            Markdown documentation rendered live from <code>docs/</code>. Every <code>.md</code> file
            in the repo is reachable here.
          </p>
        </header>
        {docs.length === 0 ? (
          <p className="docs-empty">No markdown docs found under docs/.</p>
        ) : (
          <ul className="docs-index">
            {docs.map((d) => (
              <li key={d.href}>
                <Link href={d.href}>{d.label}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}