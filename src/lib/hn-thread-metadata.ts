import { q } from "./queries/core";
import { HnThreadEvidenceSchema, type HnThreadEvidence } from "./render-payload";

const DEFAULTS = {
  maxComments: 100,
  maxDepth: 3,
  maxBranching: 20,
  representativeLimit: 8,
} as const;

export interface HnThreadEvidenceOptions {
  maxComments?: number;
  maxDepth?: number;
  maxBranching?: number;
  representativeLimit?: number;
}

interface StoryRow {
  id: number | string;
  title: string;
  url: string;
  by: string;
  time: number | string;
  score: number | string;
  descendants: number | string;
  kids: number[];
}

interface ReplyRow {
  id: number | string;
  parent: number | string;
  by: string;
  time: number | string;
  score: number | string;
  text: string;
  kids: number[];
  depth: number | string;
}

export const HN_THREAD_EVIDENCE_SQL = {
  story: `
    SELECT id, title, url, by, time, score, greatest(descendants, 0) AS descendants, kids
    FROM raw.hackernews FINAL
    WHERE id = {storyId:UInt64}
      AND type = 'story'
      AND deleted = 0
      AND dead = 0
    LIMIT 1`,
  replies: `
    WITH
      story AS (
        SELECT id, time, kids
        FROM raw.hackernews FINAL
        WHERE id = {storyId:UInt64}
          AND type = 'story'
          AND deleted = 0
          AND dead = 0
        LIMIT 1
      ),
      level1_ids AS (
        SELECT DISTINCT arrayJoin(arraySlice(kids, 1, {maxBranching:UInt32})) AS id
        FROM story
      ),
      level1 AS (
        SELECT c.id, c.parent, c.by, c.time, c.score, c.text, c.kids, toUInt8(1) AS depth
        FROM (
          SELECT id, parent, by, time, score, text, kids
          FROM raw.hackernews FINAL
          WHERE id IN (SELECT id FROM level1_ids)
            AND type = 'comment' AND deleted = 0 AND dead = 0
            AND time >= (SELECT time FROM story) AND time <= now()
        ) AS c
        INNER ANY JOIN level1_ids AS ids ON c.id = ids.id
      ),
      level2_ids AS (
        SELECT DISTINCT arrayJoin(arraySlice(kids, 1, {maxBranching:UInt32})) AS id
        FROM level1
      ),
      level2 AS (
        SELECT c.id, c.parent, c.by, c.time, c.score, c.text, c.kids, toUInt8(2) AS depth
        FROM (
          SELECT id, parent, by, time, score, text, kids
          FROM raw.hackernews FINAL
          WHERE id IN (SELECT id FROM level2_ids)
            AND type = 'comment' AND deleted = 0 AND dead = 0
            AND time >= (SELECT time FROM story) AND time <= now()
        ) AS c
        INNER ANY JOIN level2_ids AS ids ON c.id = ids.id
      ),
      level3_ids AS (
        SELECT DISTINCT arrayJoin(arraySlice(kids, 1, {maxBranching:UInt32})) AS id
        FROM level2
      ),
      level3 AS (
        SELECT c.id, c.parent, c.by, c.time, c.score, c.text, c.kids, toUInt8(3) AS depth
        FROM (
          SELECT id, parent, by, time, score, text, kids
          FROM raw.hackernews FINAL
          WHERE id IN (SELECT id FROM level3_ids)
            AND type = 'comment' AND deleted = 0 AND dead = 0
            AND time >= (SELECT time FROM story) AND time <= now()
        ) AS c
        INNER ANY JOIN level3_ids AS ids ON c.id = ids.id
      )
    SELECT id, parent, by, time, score, text, kids, depth
    FROM (
      SELECT * FROM level1
      UNION ALL
      SELECT * FROM level2
      UNION ALL
      SELECT * FROM level3
    )
    WHERE depth <= {maxDepth:UInt8}
    ORDER BY score DESC, time DESC, id ASC
    LIMIT {maxComments:UInt32}`,
} as const;

function boundedPositive(value: number | undefined, fallback: number, maximum: number) {
  const candidate = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(maximum, Math.max(1, candidate));
}

function optionsWithDefaults(options: HnThreadEvidenceOptions = {}) {
  return {
    maxComments: boundedPositive(options.maxComments, DEFAULTS.maxComments, DEFAULTS.maxComments),
    maxDepth: boundedPositive(options.maxDepth, DEFAULTS.maxDepth, DEFAULTS.maxDepth),
    maxBranching: boundedPositive(options.maxBranching, DEFAULTS.maxBranching, DEFAULTS.maxBranching),
    representativeLimit: boundedPositive(options.representativeLimit, DEFAULTS.representativeLimit, DEFAULTS.representativeLimit),
  };
}

function numberValue(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemUrl(id: number) {
  return `https://news.ycombinator.com/item?id=${id}`;
}

/** Convert HN's HTML-ish comment body into a short plain-text excerpt. */
export function sanitizeHnExcerpt(text: string | null | undefined, maxLength = 280) {
  const plain = (text ?? "")
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

export function buildHnThreadEvidence(
  story: StoryRow,
  replies: ReplyRow[],
  options: HnThreadEvidenceOptions = {},
): HnThreadEvidence {
  const limits = optionsWithDefaults(options);
  const storyId = numberValue(story.id);
  const deduplicatedReplies = [...new Map(replies.map((reply) => [numberValue(reply.id), reply])).values()]
    .sort((a, b) => numberValue(b.score) - numberValue(a.score) || numberValue(b.time) - numberValue(a.time) || numberValue(a.id) - numberValue(b.id));
  const commentsTruncated = deduplicatedReplies.length > limits.maxComments;
  const uniqueReplies = deduplicatedReplies
    .filter((reply) => numberValue(reply.depth) <= limits.maxDepth)
    .slice(0, limits.maxComments);
  const observedIds = new Set(uniqueReplies.map((reply) => numberValue(reply.id)));
  const expectedIds = new Set((story.kids ?? []).map(numberValue));
  for (const reply of uniqueReplies) {
    if (numberValue(reply.depth) < limits.maxDepth) {
      for (const id of (reply.kids ?? []).slice(0, limits.maxBranching).map(numberValue)) expectedIds.add(id);
    }
  }
  const missingItems = [...expectedIds].some((id) => !observedIds.has(id));
  const branchTruncated = (story.kids ?? []).length > limits.maxBranching || uniqueReplies.some((reply) => (reply.kids ?? []).length > limits.maxBranching);
  const depthTruncated = uniqueReplies.some((reply) => numberValue(reply.depth) >= limits.maxDepth && (reply.kids ?? []).length > 0);
  const truncated = branchTruncated || depthTruncated || commentsTruncated;
  const partial = truncated || missingItems;
  const reason = commentsTruncated || branchTruncated ? "sampling_limit" : depthTruncated ? "depth_limit" : missingItems ? "missing_items" : "within_bounds";
  const maxObservedDepth = uniqueReplies.reduce((max, reply) => Math.max(max, numberValue(reply.depth)), 0);
  const maxObservedBranching = Math.max(0, story.kids?.length ?? 0, ...uniqueReplies.map((reply) => reply.kids?.length ?? 0));

  return HnThreadEvidenceSchema.parse({
    story: {
      id: storyId,
      title: story.title ?? "",
      url: itemUrl(storyId),
      author: story.by ?? "",
      time: numberValue(story.time),
      score: numberValue(story.score),
    },
    descendantsReported: Math.max(0, numberValue(story.descendants)),
    commentsObserved: uniqueReplies.length,
    topLevelRepliesObserved: uniqueReplies.filter((reply) => numberValue(reply.parent) === storyId).length,
    completeness: { state: partial ? "partial" : "complete", reason },
    sampling: { ...limits, truncated },
    depth: { maxObserved: maxObservedDepth, limit: limits.maxDepth, bounded: true },
    branching: { maxObserved: maxObservedBranching, limit: limits.maxBranching, bounded: true },
    representativeReplies: uniqueReplies.slice(0, limits.representativeLimit).map((reply) => ({
      id: numberValue(reply.id),
      parent: numberValue(reply.parent),
      author: reply.by ?? "",
      time: numberValue(reply.time),
      score: numberValue(reply.score),
      excerpt: sanitizeHnExcerpt(reply.text),
      depth: Math.max(1, numberValue(reply.depth)),
      url: itemUrl(numberValue(reply.id)),
    })),
  });
}

export async function hnThreadEvidence(storyId: number, options: HnThreadEvidenceOptions = {}) {
  const limits = optionsWithDefaults(options);
  const params = { storyId, ...limits };
  const storyResult = await q<StoryRow>(HN_THREAD_EVIDENCE_SQL.story, ["raw.hackernews"], params);
  const story = storyResult.rows[0];
  if (!story) return null;
  const replyResult = await q<ReplyRow>(HN_THREAD_EVIDENCE_SQL.replies, ["raw.hackernews"], params);
  return buildHnThreadEvidence(story, replyResult.rows, limits);
}
