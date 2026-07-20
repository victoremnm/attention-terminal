import { z } from "zod";

export const VerdictSchema = z.enum([
  "ACCELERATING",
  "PEAKING",
  "COOLING",
  "DORMANT",
  "BREAKOUT",
  "DIVERGENT",
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

const BriefingTileSchema = z.object({
  kicker: z.string().max(32),
  value: z.string().max(80),
  detail: z.string().max(160),
  tone: z.enum(["accel", "break", "neutral"]).optional(),
});

const BriefingBuzzTokenSchema = z.object({
  token: z.string().max(40),
  surge: z.number(),
  mentions: z.number().int().nonnegative(),
  baselineNote: z.string().max(80),
});

const BriefingFrontPageRowSchema = z.object({
  rank: z.number().int().positive(),
  id: z.number().int(),
  title: z.string().max(240),
  site: z.string().max(160),
  score: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  perHour: z.number(),
  verdict: VerdictSchema,
});

const BriefingRisingRowSchema = z.object({
  id: z.number().int(),
  title: z.string().max(240),
  perHour: z.number(),
  ageLabel: z.string().max(32),
});

const BriefingDomainSchema = z.object({
  domain: z.string().max(160),
  score: z.number().nonnegative(),
  stories: z.number().int().nonnegative(),
  note: z.string().max(160).optional(),
});

export const BriefingSchema = z.object({
  type: z.literal("briefing"),
  generatedAt: z.string(),
  question: z.string().max(240),
  freshness: z.string().max(160),
  tiles: z.array(BriefingTileSchema).length(3),
  pulse: z.object({
    hours: z.array(z.string()),
    stories: z.array(z.number()),
    comments: z.array(z.number()),
  }),
  buzz: z.array(BriefingBuzzTokenSchema),
  frontPage: z.array(BriefingFrontPageRowSchema),
  rising: z.array(BriefingRisingRowSchema),
  domains: z.array(BriefingDomainSchema),
  sql: z.string().max(4000),
});

export const RenderPayloadSchema = z.discriminatedUnion("type", [
  DigestSchema,
  TickerSchema,
  DivergenceSchema,
  CandlesSchema,
  MatrixSchema,
  BriefingSchema,
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
export type BriefingTile = z.infer<typeof BriefingTileSchema>;
export type BriefingBuzzToken = z.infer<typeof BriefingBuzzTokenSchema>;
export type BriefingFrontPageRow = z.infer<typeof BriefingFrontPageRowSchema>;
export type BriefingRisingRow = z.infer<typeof BriefingRisingRowSchema>;
export type BriefingDomain = z.infer<typeof BriefingDomainSchema>;
export type BriefingPayload = z.infer<typeof BriefingSchema>;
export type RenderPayload = z.infer<typeof RenderPayloadSchema>;
