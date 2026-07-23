import { z } from "zod";

export const VerdictSchema = z.enum([
  "ACCELERATING",
  "PEAKING",
  "COOLING",
  "DORMANT",
  "BREAKOUT",
  "DIVERGENT",
]);

export const VisualizationTypeSchema = z.enum([
  "Line Graph",
  "Area Chart",
  "Slopegraph",
  "Waterfall Chart",
  "Gantt Chart",
  "Bar Chart",
  "Dot Plot",
  "Bullet Graph",
  "Data Table",
  "Pie Chart",
  "Stacked Bar Chart",
  "Square Area Chart",
  "Treemap",
  "Unit Chart",
  "Boxplot",
  "Scatterplot",
  "Bubble Chart",
  "Spider Chart",
  "Sankey Diagram",
  "Flow Chart",
  "Choropleth Map",
]);

export const VerdictTileSchema = z.object({
  state: VerdictSchema,
  metric: z.number(),
  metricLabel: z.string().max(64),
  rule: z.string().max(240),
  detail: z.string().max(240).optional(),
});

export const EvidenceLinkSchema = z.object({
  title: z.string().max(240),
  url: z.string().url(),
  source: z.enum(["hn", "github", "external"]),
  score: z.number().optional(),
  comments: z.number().optional(),
});

export const DigestClusterSchema = z.object({
  id: z.string(),
  subject: z.string(),
  verdict: VerdictSchema,
  band: z.enum(["shipping", "debated", "hype"]),
  skinny: z.string().max(360),
  talkShare: z.number().min(0).max(1),
  spark: z.array(z.number()),
  sources: z.object({
    hnThreads: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    ghStars24h: z.number().int().nonnegative(),
    repos: z.number().int().nonnegative(),
  }),
  links: z.object({
    hn: z.string().url(),
    github: z.string().url(),
  }),
  takes: z
    .object({
      agree: z.array(EvidenceLinkSchema),
      dispute: z.array(EvidenceLinkSchema),
      outlier: EvidenceLinkSchema.optional(),
    })
    .optional(),
});

export const DigestSchema = z.object({
  type: z.literal("digest"),
  generatedAt: z.string(),
  noiseFloor: z.number().min(0).max(1),
  clusters: z.array(DigestClusterSchema),
});

const TickerCardSchema = z.object({
  kicker: z.string().max(32),
  name: z.string().max(160),
  metric: z.string().max(80),
  delta: z.string().max(120).optional(),
  stats: z.array(z.object({
    label: z.string().max(32),
    value: z.string().max(32),
    tone: z.enum(["hot", "muted"]).optional(),
  })).optional(),
  spark: z.array(z.number()).optional(),
  href: z.string().url().optional(),
});

export const TickerSchema = z.object({
  type: z.literal("ticker"),
  filter: z.enum(["repos", "stars", "stories", "all"]),
  generatedAt: z.string(),
  items: z.array(TickerCardSchema),
});

export const DivergenceSchema = z.object({
  type: z.literal("divergence"),
  subject: z.string().max(120),
  verdict: VerdictTileSchema,
  days: z.array(z.string()),
  talk: z.array(z.number()),
  code: z.array(z.number()),
  caption: z.string().max(320),
  freshness: z.string().max(160).optional(),
});

export const CandlesSchema = z.object({
  type: z.literal("candles"),
  subject: z.string().max(120),
  verdict: VerdictTileSchema,
  days: z.array(z.string()),
  values: z.array(z.number()),
  caption: z.string().max(320),
  freshness: z.string().max(160).optional(),
});

export const MatrixSchema = z.object({
  type: z.literal("matrix"),
  generatedAt: z.string(),
  topics: z.array(z.object({
    name: z.string().max(120),
    volume: z.number().nonnegative(),
    velocity: z.number(),
    ghShare: z.number().min(0).max(1),
    verdict: VerdictSchema.optional(),
  })),
});

// view-SQL: the exact query behind the card + real read stats. Not a reconstruction.
export const CardQuerySchema = z.object({
  sql: z.string(),
  rowsRead: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});

export const MorphingCardSchema = z.object({
  type: z.literal("morphing-card"),
  visualizationType: VisualizationTypeSchema,
  generatedAt: z.string(),
  chartConfig: z.record(z.string(), z.unknown()),
  summary: z.string().optional(),
  query: CardQuerySchema.optional(),
});

export const TableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["number", "string", "date", "link"]).default("string"),
});

export const TablePayloadSchema = z.object({
  type: z.literal("table"),
  columns: z.array(TableColumnSchema).min(1).max(20),
  rows: z.array(z.record(z.string(), z.unknown())),
  totals: z.record(z.string(), z.number()).optional(),
  summary: z.string().optional(),
  query: CardQuerySchema.optional(),
});

// --- Daily Skinny deck (tactile finishable card deck; see docs/architecture/AGENT-FLEET-PLAN.md §4.2) ---

export const DevPointSchema = z.object({
  actor: z.string().max(120),
  pushes: z.number().int().nonnegative(),
  repos: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  prs: z.number().int().nonnegative(),
  mergedPrs: z.number().int().nonnegative(),
});

// A card's visual is a discriminated union on `kind` (distinct from top-level payload `type`).
export const DevScatterVisualSchema = z.object({
  kind: z.literal("dev-scatter"),
  window: z.enum(["7d", "30d"]),
  points: z.array(DevPointSchema),
  note: z.string().max(240).optional(), // discloses dropped rows (bots/spam) — no silent caps
});

export const DivergenceVisualSchema = z.object({
  kind: z.literal("divergence"),
  days: z.array(z.string()),
  talk: z.array(z.number()),
  code: z.array(z.number()),
});

export const CandlesVisualSchema = z.object({
  kind: z.literal("candles"),
  days: z.array(z.string()),
  values: z.array(z.number()),
});

export const SkinnyVisualSchema = z.discriminatedUnion("kind", [
  DevScatterVisualSchema,
  DivergenceVisualSchema,
  CandlesVisualSchema,
]);

export const SkinnyCommentSchema = z.object({
  author: z.string().max(120),
  pts: z.number().int(),
  ago: z.string().max(40),
  body: z.string().max(600),
});

export const SkinnyCardSchema = z.object({
  id: z.string(),
  subject: z.string().max(120),
  verdict: VerdictSchema,
  metric: z.string().max(40), // load-bearing number, e.g. "2.4x"
  metricLabel: z.string().max(64),
  caption: z.string().max(320), // <=2 sentences, third-person
  sources: z.string().max(120), // e.g. "200 HN · 121 repos"
  visual: SkinnyVisualSchema,
  topComment: SkinnyCommentSchema.optional(),
  commentsCount: z.number().int().nonnegative().optional(),
  hnThreadUrl: z.string().url().optional(),
  query: CardQuerySchema, // powers the flip-to-view-SQL reveal
});

export const SkinnyDeckSchema = z.object({
  type: z.literal("skinny-deck"),
  dateStr: z.string(),
  generatedAt: z.string(),
  cards: z.array(SkinnyCardSchema), // finite — the deck runs out (no refill)
});

export const RepoDrilldownSchema = z.object({
  type: z.literal("repo-drilldown"),
  repoName: z.string().max(160),
  generatedAt: z.string(),
  metadata: z.object({
    description: z.string().max(500),
    language: z.string().max(80),
    topics: z.array(z.string().max(80)),
    githubStars: z.number().int().nonnegative(),
    githubForks: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
  }),
  kpis24h: z.object({
    pushes: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
    distinctCommits: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    stars: z.number().int().nonnegative(),
    issuesOpened: z.number().int().nonnegative(),
    prsOpened: z.number().int().nonnegative(),
    prsMerged: z.number().int().nonnegative(),
    actors: z.number().int().nonnegative(),
  }),
  velocity: z.array(z.object({
    hour: z.string(),
    pushes: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    stars: z.number().int().nonnegative(),
    issuesOpened: z.number().int().nonnegative(),
    prsOpened: z.number().int().nonnegative(),
  })),
  topActors24h: z.array(z.object({
    actor: z.string().max(120),
    pushes: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
    distinctCommits: z.number().int().nonnegative(),
    prsOpened: z.number().int().nonnegative(),
    prsMerged: z.number().int().nonnegative(),
    issuesOpened: z.number().int().nonnegative(),
    releasesPublished: z.number().int().nonnegative(),
    isBot: z.boolean().default(false),
  })).default([]),
  feed: z.array(z.object({
    at: z.string(),
    actor: z.string().max(120),
    eventType: z.enum(["PushEvent", "PullRequestEvent", "IssuesEvent"]),
    action: z.string().max(80),
    commits: z.number().int().nonnegative(),
    distinctCommits: z.number().int().nonnegative(),
    merged: z.boolean(),
    title: z.string().optional(),
    labels: z.array(z.string()).optional(),
  })),
  analysis: z
    .object({
      overview: z.string(),
      techStack: z.array(z.string()),
      keyFiles: z.array(z.string()),
      architectureSummary: z.string(),
      analyzedAt: z.string().optional(),
    })
    .optional(),
  // REST-activity enrichment (issue #79 track #83). Optional — omitted when
  // the watchlist poller (#82) hasn't populated the activity tables yet, so
  // the renderer degrades gracefully to the v1 layout.
  activity: z
    .object({
      commits: z.array(z.object({
        sha: z.string(),
        author: z.string(),
        authorDate: z.string(),
        message: z.string(),
      })),
      prs: z.array(z.object({
        number: z.number().int(),
        title: z.string(),
        state: z.string(),
        author: z.string(),
        createdAt: z.string(),
        mergedAt: z.string(),
        closedAt: z.string(),
        labels: z.array(z.string()),
      })),
      releases: z.array(z.object({
        tag: z.string(),
        name: z.string(),
        author: z.string(),
        publishedAt: z.string(),
        body: z.string(),
      })),
      issues: z.array(z.object({
        number: z.number().int(),
        title: z.string(),
        state: z.string(),
        author: z.string(),
        createdAt: z.string(),
        closedAt: z.string(),
        labels: z.array(z.string()),
        comments: z.number().int().nonnegative(),
      })),
    })
    .optional(),
  // 30-day trend timeline: daily star/fork counts with annotated content
  // events (release / PR-merge / issue-open). Optional — omitted when the
  // trends query returns no rows.
  trends: z
    .array(z.object({
      date: z.string(),
      stars: z.number().nonnegative(),
      forks: z.number().nonnegative(),
      events: z.array(z.object({
        type: z.enum(["release", "pr_merged", "issue_opened"]),
        label: z.string(),
        url: z.string().url(),
      })),
    }))
    .optional(),
  // Pulse-style overview (issue #79): GitHub's /pulse page computed en-masse
  // from the REST-activity tables instead of on-demand per repo visit.
  // 7-day window matches the activity lists. Optional — omitted when the
  // poller hasn't populated the tables yet.
  pulse: z
    .object({
      windowDays: z.number().int().positive(),
      // PR breakdown
      prsMerged: z.number().int().nonnegative(),
      prsOpened: z.number().int().nonnegative(),
      prsOpen: z.number().int().nonnegative(),
      prsActive: z.number().int().nonnegative(), // merged + opened + still-open
      // Issue breakdown
      issuesClosed: z.number().int().nonnegative(),
      issuesOpened: z.number().int().nonnegative(),
      issuesOpen: z.number().int().nonnegative(),
      issuesActive: z.number().int().nonnegative(), // closed + opened + still-open
      // Commit summary (Pulse's "N authors pushed M commits")
      commitAuthors: z.number().int().nonnegative(),
      commitCount: z.number().int().nonnegative(),
      // Top committers bar chart (Pulse's "Top committers" viz)
      topCommitters: z.array(z.object({
        author: z.string().max(120),
        commits: z.number().int().nonnegative(),
      })),
    })
    .optional(),
  // Weekly code frequency (additions/deletions) from GitHub REST API.
  // Optional — omitted when the REST fetch fails or returns empty data.
  codeFrequency: z
    .array(z.object({
      week: z.string(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }))
    .optional(),
  query: CardQuerySchema,
});

export const RenderPayloadSchema = z.discriminatedUnion("type", [
  DigestSchema,
  TickerSchema,
  DivergenceSchema,
  CandlesSchema,
  MatrixSchema,
  SkinnyDeckSchema,
  RepoDrilldownSchema,
  MorphingCardSchema,
  TablePayloadSchema,
]);

export type Verdict = z.infer<typeof VerdictSchema>;
export type VerdictTile = z.infer<typeof VerdictTileSchema>;
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;
export type DigestCluster = z.infer<typeof DigestClusterSchema>;
export type DigestPayload = z.infer<typeof DigestSchema>;
export type TickerPayload = z.infer<typeof TickerSchema>;
export type DivergencePayload = z.infer<typeof DivergenceSchema>;
export type CandlesPayload = z.infer<typeof CandlesSchema>;
export type MatrixPayload = z.infer<typeof MatrixSchema>;
export type DevPoint = z.infer<typeof DevPointSchema>;
export type SkinnyVisual = z.infer<typeof SkinnyVisualSchema>;
export type CardQuery = z.infer<typeof CardQuerySchema>;
export type SkinnyCard = z.infer<typeof SkinnyCardSchema>;
export type SkinnyDeckPayload = z.infer<typeof SkinnyDeckSchema>;
export type RepoDrilldownPayload = z.infer<typeof RepoDrilldownSchema>;
export type RepoDrilldownActivity = NonNullable<RepoDrilldownPayload["activity"]>;
export type RepoDrilldownTrend = NonNullable<RepoDrilldownPayload["trends"]>[number];
export type RepoDrilldownTrendEvent = RepoDrilldownTrend["events"][number];
export type RepoDrilldownPulse = NonNullable<RepoDrilldownPayload["pulse"]>;
export type MorphingCardPayload = z.infer<typeof MorphingCardSchema>;
export type TableColumn = z.infer<typeof TableColumnSchema>;
export type TablePayload = z.infer<typeof TablePayloadSchema>;
export type VisualizationType = z.infer<typeof VisualizationTypeSchema>;
export type RenderPayload = z.infer<typeof RenderPayloadSchema>;
