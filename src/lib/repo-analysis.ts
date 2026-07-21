import { clickhouseInsert } from "./clickhouse";
import { authHeaders, chDateTime, FetchOptions, respectRateLimit } from "./github-repo";

export interface GhRepoAnalysisRow {
  repo_name: string;
  overview: string;
  tech_stack: string[];
  key_files: string[];
  architecture_summary: string;
  analyzed_at: string;
}

export interface RepoAnalysisData {
  overview: string;
  techStack: string[];
  keyFiles: string[];
  architectureSummary: string;
  analyzedAt?: string;
}

const GITHUB_API = "https://api.github.com";
const FAST_MODE_TIMEOUT_MS = 4_000;

export async function fetchRepoReadme(repoName: string, options?: FetchOptions): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}/repos/${repoName}/readme`, {
        headers: {
          ...authHeaders(),
          accept: "application/vnd.github.raw+json",
        },
        signal: options?.fast ? AbortSignal.timeout(FAST_MODE_TIMEOUT_MS) : undefined,
      });
    } catch (error) {
      console.log("[repo-analysis] GitHub readme fetch errored", { repoName, error });
      return null;
    }
    if (res.status === 404 || res.status === 451) return null;
    if (await respectRateLimit(res, options)) continue;
    if (!res.ok) {
      console.log("[repo-analysis] GitHub readme fetch failed", { repoName, status: res.status });
      return null;
    }
    return await res.text();
  }
  return null;
}

export function generateAnalysisFromReadme(
  repoName: string,
  readmeText: string | null,
  metaLanguage?: string,
  metaTopics?: string[]
): Omit<GhRepoAnalysisRow, "repo_name" | "analyzed_at"> {
  const techStackSet = new Set<string>();

  if (metaLanguage) techStackSet.add(metaLanguage);
  if (metaTopics) {
    for (const t of metaTopics) {
      if (t.length <= 30) techStackSet.add(t);
    }
  }

  if (readmeText) {
    const commonTech = [
      "TypeScript", "JavaScript", "Python", "Rust", "Go", "React", "Next.js",
      "Vue", "Node.js", "Docker", "ClickHouse", "Trigger.dev", "PostgreSQL",
      "TailwindCSS", "GraphQL", "Redis", "Kafka", "Prisma", "PyTorch", "Kubernetes"
    ];
    for (const tech of commonTech) {
      if (new RegExp(`\\b${tech.replace(".", "\\.")}\\b`, "i").test(readmeText)) {
        techStackSet.add(tech);
      }
    }
  }

  const techStack = Array.from(techStackSet).slice(0, 10);

  let overview = `${repoName} is a software repository on GitHub.`;
  let architectureSummary = "Standard repository layout with source code and documentation.";

  if (readmeText) {
    const cleanLines = readmeText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("!") && !l.startsWith("["));

    if (cleanLines.length > 0) {
      const summarySnippet = cleanLines.slice(0, 3).join(" ").slice(0, 320);
      if (summarySnippet.length > 20) {
        overview = summarySnippet;
      }
    }

    const archHeadings = readmeText
      .split("\n")
      .filter((l) => /^#{1,3}\s+/.test(l.trim()))
      .map((l) => l.replace(/^#{1,3}\s+/, "").trim())
      .filter((h) => /architecture|how it works|overview|features|structure|design/i.test(h));

    if (archHeadings.length > 0) {
      architectureSummary = `Includes core sections on: ${archHeadings.slice(0, 4).join(", ")}.`;
    }
  }

  const keyFiles = [
    "README.md",
    "package.json",
    "src/",
    "app/",
    "docs/",
  ].filter((f) => !readmeText || readmeText.toLowerCase().includes(f.toLowerCase().replace("/", "")));

  return {
    overview,
    tech_stack: techStack,
    key_files: keyFiles.length ? keyFiles : ["README.md", "src/"],
    architecture_summary: architectureSummary,
  };
}

export async function analyzeAndStoreRepo(
  repoName: string,
  metaLanguage?: string,
  metaTopics?: string[],
  options?: FetchOptions
): Promise<GhRepoAnalysisRow | null> {
  try {
    const readme = await fetchRepoReadme(repoName, options);
    const analysis = generateAnalysisFromReadme(repoName, readme, metaLanguage, metaTopics);
    const now = new Date();
    const row: GhRepoAnalysisRow = {
      repo_name: repoName,
      ...analysis,
      analyzed_at: chDateTime(now.toISOString()),
    };

    try {
      await clickhouseInsert.insert({
        table: "gh_repo_analysis",
        values: [row],
        format: "JSONEachRow",
      });
    } catch (insertError) {
      console.error("[repo-analysis] ClickHouse insert for gh_repo_analysis failed", {
        repoName,
        error: insertError,
      });
    }

    return row;
  } catch (error) {
    console.error("[repo-analysis] Failed to analyze repository", { repoName, error });
    return null;
  }
}
