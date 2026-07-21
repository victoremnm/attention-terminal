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

export const MorphingCardSchema = z.object({
  type: z.literal("morphing-card"),
  visualizationType: VisualizationTypeSchema,
  generatedAt: z.string(),
  chartConfig: z.record(z.string(), z.unknown()),
  summary: z.string().optional(),
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

// view-SQL: the exact query behind the card + real read stats. Not a reconstruction.
export const CardQuerySchema = z.object({
  sql: z.string(),
  rowsRead: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});

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
  feed: z.array(z.object({
    at: z.string(),
    actor: z.string().max(120),
    eventType: z.enum(["PushEvent", "PullRequestEvent"]),
    action: z.string().max(80),
    commits: z.number().int().nonnegative(),
    distinctCommits: z.number().int().nonnegative(),
    merged: z.boolean(),
  })),
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
export type MorphingCardPayload = z.infer<typeof MorphingCardSchema>;
export type VisualizationType = z.infer<typeof VisualizationTypeSchema>;
export type RenderPayload = z.infer<typeof RenderPayloadSchema>;
