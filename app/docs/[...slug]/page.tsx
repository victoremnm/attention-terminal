import fs from "fs/promises";
import path from "path";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

const DOCS_ROOT = path.join(process.cwd(), "docs");

marked.use({ gfm: true });

function safeJoinDocs(relativeSegments: string[]): string {
  const joined = relativeSegments.join("/");
  const resolved = path.resolve(DOCS_ROOT, joined);
  if (resolved !== DOCS_ROOT && !resolved.startsWith(DOCS_ROOT + path.sep)) {
    throw new Error("path escapes docs root");
  }
  return resolved;
}

async function resolveDocFile(slug: string[]): Promise<string | null> {
  const candidate = safeJoinDocs(slug);
  let filePath = candidate.endsWith(".md") ? candidate : `${candidate}.md`;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) return filePath;
  } catch {
    /* fall through */
  }
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      const indexFile = path.join(candidate, "README.md");
      try {
        const indexStat = await fs.stat(indexFile);
        if (indexStat.isFile()) return indexFile;
      } catch {
        /* no index */
      }
    }
  } catch {
    /* not a directory */
  }
  return null;
}

async function walkDocsForParams(dir: string, base: string, acc: string[][]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      await walkDocsForParams(full, base, acc);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      acc.push(rel.replace(/\.md$/, "").split(path.sep));
    }
  }
}

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  const params: string[][] = [];
  try {
    await walkDocsForParams(DOCS_ROOT, DOCS_ROOT, params);
  } catch {
    /* docs root missing */
  }
  return params.map((slug) => ({ slug }));
}

function deriveTitle(slugParts: string[]): string {
  const last = slugParts[slugParts.length - 1] ?? "documentation";
  return (
    last
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bmd\b/gi, "") + " · Docs · Attention Terminal"
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: deriveTitle(slug),
    description: "Rendered markdown documentation for the Attention Terminal.",
  };
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const filePath = await resolveDocFile(slug);
  if (!filePath) notFound();

  const fileContent = await fs.readFile(filePath, "utf-8");
  const rawHtml = await marked.parse(fileContent);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "del", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "a", "code", "pre", "blockquote", "hr", "table",
      "thead", "tbody", "tr", "th", "td", "img", "span", "div",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "src", "alt", "width", "height"],
    ALLOW_DATA_ATTR: false,
  });

  return (
    <main className="docs-page">
      <div className="docs-page-inner">
        <header className="docs-page-header">
          <Link href="/docs" className="docs-back-link">
            ← docs index
          </Link>
        </header>
        <article className="markdown-text docs-article" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
      </div>
    </main>
  );
}