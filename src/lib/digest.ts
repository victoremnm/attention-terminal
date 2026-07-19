import { q } from "./queries";
import { DigestSchema, type DigestCluster, type DigestPayload, type EvidenceLink, type Verdict } from "./render-payload";

const TOPICS = [
  { key: "postgres", subject: "Postgres 18", tokens: ["postgres", "postgresql", "pg"], repos: ["postgres", "postgresql"] },
  { key: "sqlite", subject: "SQLite", tokens: ["sqlite"], repos: ["sqlite"] },
  { key: "clickhouse", subject: "ClickHouse", tokens: ["clickhouse"], repos: ["clickhouse"] },
  { key: "bun", subject: "Bun", tokens: ["bun", "oven"], repos: ["oven-sh/bun", "bun"] },
  { key: "deno", subject: "Deno", tokens: ["deno"], repos: ["denoland/deno", "deno"] },
  { key: "rust", subject: "Rust", tokens: ["rust"], repos: ["rust-lang", "rust"] },
  { key: "react", subject: "React", tokens: ["react"], repos: ["facebook/react", "react"] },
  { key: "nextjs", subject: "Next.js", tokens: ["nextjs", "next"], repos: ["vercel/next.js", "next.js"] },
  { key: "tailwind", subject: "Tailwind CSS", tokens: ["tailwind"], repos: ["tailwindlabs/tailwindcss", "tailwind"] },
  { key: "llama", subject: "Llama", tokens: ["llama"], repos: ["llama"] },
  { key: "qwen", subject: "Qwen", tokens: ["qwen"], repos: ["qwen"] },
  { key: "graphify", subject: "Graphify", tokens: ["graphify"], repos: ["graphify-labs/graphify", "graphify"] },
  { key: "attention-terminal", subject: "Attention Terminal", tokens: ["attention", "terminal"], repos: ["victoremnm/attention-terminal", "clickhouse-trigger-hackathon"] },
] as const;

type Topic = (typeof TOPICS)[number];

interface ActivityRow {
  subject: string;
  age: number;
  talk_threads: string;
  comments: string;
  code_score: string;
  gh_stars: string;
  repos: string;
}

interface TakeRow {
  id: number;
  title: string;
  score: number;
  comments: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hnSearchUrl = (topic: Topic) =>
  `https://hn.algolia.com/?dateRange=last30d&page=0&prefix=false&query=${encodeURIComponent(topic.tokens.join(" OR "))}&sort=byDate&type=story`;
const githubSearchUrl = (topic: Topic) =>
  `https://github.com/search?q=${encodeURIComponent(topic.repos.join(" OR "))}&type=repositories&s=updated&o=desc`;
const hnItemUrl = (id: number) => `https://news.ycombinator.com/item?id=${id}`;

function tokenWhere(topic: Topic) {
  return topic.tokens.map((token) => `hasToken(lower(title), ${sqlString(token)})`).join(" OR ");
}

// Subject mapping for HN titles, generated from TOPICS so it stays in lockstep
// with the rollup migration (same tokens, same first-match order).
function hnSubjectExpr() {
  const branches = TOPICS.map((topic) => `${tokenWhere(topic)}, ${sqlString(topic.subject)}`).join(",\n          ");
  return `multiIf(\n          ${branches},\n          '')`;
}

function hnSubjectFilter() {
  return TOPICS.map((topic) => `(${tokenWhere(topic)})`).join(" OR ");
}

function verdictFor(talkZ: number, codeZ: number, spark: number[]): Verdict {
  const spread = talkZ / Math.max(codeZ, 0.01);
  if (spread >= 2 || spread <= 0.5) return "DIVERGENT";
  const peak = Math.max(talkZ, codeZ);
  if (peak >= 3) return "BREAKOUT";
  if (peak >= 1.5) return "ACCELERATING";
  if (spark.at(-1) === Math.max(...spark)) return "PEAKING";
  return peak < 0.75 ? "DORMANT" : "COOLING";
}

function bandFor(talkZ: number, codeZ: number): DigestCluster["band"] {
  if (codeZ > talkZ * 1.15) return "shipping";
  if (talkZ > codeZ * 1.6) return "hype";
  return "debated";
}

function skinnyFor(cluster: {
  subject: string;
  band: DigestCluster["band"];
  talkZ: number;
  codeZ: number;
  hnThreads: number;
  ghStars24h: number;
  repos: number;
}) {
  const talk = cluster.talkZ.toFixed(1);
  const code = cluster.codeZ.toFixed(1);
  if (cluster.band === "shipping") {
    return `${cluster.subject} is moving more in code than in chatter: code is ${code}x baseline vs talk at ${talk}x. ${cluster.repos} repos contributed signal in the last day.`;
  }
  if (cluster.band === "hype") {
    return `${cluster.subject} is louder in talk than code right now: talk is ${talk}x baseline vs code at ${code}x. Treat it as narrative until repos or stars catch up.`;
  }
  return `${cluster.subject} has both conversation and implementation heat: talk is ${talk}x baseline and code is ${code}x. The useful read is the disagreement, not either feed alone.`;
}

function activitySql() {
  return `WITH
    toStartOfHour((SELECT max(time) FROM hackernews)) AS hn_as_of,
    (SELECT maxIf(hour, source = 'gh') FROM daily_skinny_subject_hourly) AS gh_as_of
  SELECT
    subject,
    age,
    sum(talk_threads) AS talk_threads,
    sum(comments) AS comments,
    sum(code_score) AS code_score,
    sum(gh_stars) AS gh_stars,
    sum(repos) AS repos
  FROM (
    -- HN threads/comments are read live from the deduped hackernews table
    -- (ReplacingMergeTree, resolved with argMax(update_time)). The daily_skinny
    -- HN materialized view counts every re-inserted score/comment update, so its
    -- talk_threads/comments drift upward; sourcing them here keeps counts honest.
    SELECT
      subject,
      toUInt8(intDiv(dateDiff('hour', hour, hn_as_of), 24)) AS age,
      uniqExact(id) AS talk_threads,
      sum(comments) AS comments,
      0 AS code_score,
      0 AS gh_stars,
      0 AS repos
    FROM (
      SELECT
        id,
        any(hour) AS hour,
        any(subject) AS subject,
        greatest(argMax(descendants, update_time), 0) AS comments
      FROM (
        SELECT
          id,
          toStartOfHour(time) AS hour,
          update_time,
          descendants,
          ${hnSubjectExpr()} AS subject
        FROM hackernews
        WHERE type = 'story'
          AND deleted = 0
          AND dead = 0
          AND time >= hn_as_of - INTERVAL 30 DAY
          AND (${hnSubjectFilter()})
      )
      GROUP BY id
    )
    GROUP BY subject, age

    UNION ALL

    -- GH activity is insert-once (idempotent hourly load), so the rollup is accurate.
    SELECT
      subject,
      toUInt8(intDiv(dateDiff('hour', hour, gh_as_of), 24)) AS age,
      0 AS talk_threads,
      0 AS comments,
      sum(code_score) AS code_score,
      sum(gh_stars) AS gh_stars,
      uniqMerge(repos) AS repos
    FROM daily_skinny_subject_hourly
    WHERE source = 'gh' AND hour >= gh_as_of - INTERVAL 30 DAY AND hour <= gh_as_of
    GROUP BY subject, age
  )
  WHERE subject != ''
  GROUP BY subject, age
  ORDER BY subject, age`;
}

export async function dailyDigest(noiseFloor = 0.2): Promise<DigestPayload> {
  const safeFloor = clamp01(noiseFloor);
  const { rows } = await q<ActivityRow>(activitySql(), ["daily_skinny_subject_hourly", "hackernews"]);
  const bySubject = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const current = bySubject.get(row.subject) ?? [];
    current.push(row);
    bySubject.set(row.subject, current);
  }

  const clusters = [...bySubject.entries()]
    .map(([subject, subjectRows]) => {
      const topic = TOPICS.find((candidate) => candidate.subject === subject);
      const recent = subjectRows.filter((row) => row.age === 0);
      const baseline = subjectRows.filter((row) => row.age > 0);
      const talk24h = sum(recent.map((row) => Number(row.talk_threads)));
      const code24h = sum(recent.map((row) => Number(row.code_score)));
      const comments = sum(recent.map((row) => Number(row.comments)));
      const ghStars24h = sum(recent.map((row) => Number(row.gh_stars)));
      const repos = sum(recent.map((row) => Number(row.repos)));
      const talkZ = talk24h / Math.max(sum(baseline.map((row) => Number(row.talk_threads))) / 29, 0.5);
      const codeZ = code24h / Math.max(sum(baseline.map((row) => Number(row.code_score))) / 29, 0.5);
      const signal = clamp01(Math.max(talkZ, codeZ) / 5);
      const dayMap = new Map(subjectRows.map((row) => [row.age, Number(row.talk_threads) + Number(row.code_score)]));
      const spark = Array.from({ length: 7 }, (_, i) => dayMap.get(6 - i) ?? 0);
      const talkShare = (talk24h + code24h) > 0 ? talk24h / (talk24h + code24h) : 0;
      const band = bandFor(talkZ, codeZ);
      return {
        id: slug(subject),
        subject,
        verdict: verdictFor(talkZ, codeZ, spark),
        band,
        skinny: skinnyFor({ subject, band, talkZ, codeZ, hnThreads: talk24h, ghStars24h, repos }),
        talkShare: clamp01(talkShare),
        spark,
        sources: {
          hnThreads: Math.round(talk24h),
          comments: Math.round(comments),
          ghStars24h: Math.round(ghStars24h),
          repos: Math.round(repos),
        },
        links: {
          hn: topic ? hnSearchUrl(topic) : `https://hn.algolia.com/?dateRange=last30d&page=0&prefix=false&query=${encodeURIComponent(subject)}&sort=byDate&type=story`,
          github: topic ? githubSearchUrl(topic) : `https://github.com/search?q=${encodeURIComponent(subject)}&type=repositories&s=updated&o=desc`,
        },
        signal,
      };
    })
    .filter((cluster) => cluster.signal >= safeFloor)
    .sort((a, b) => Math.max(...b.spark) - Math.max(...a.spark))
    .slice(0, 8)
    .map(({ signal: _signal, ...cluster }) => cluster);

  return DigestSchema.parse({
    type: "digest",
    generatedAt: new Date().toISOString(),
    noiseFloor: safeFloor,
    clusters,
  });
}

export function topicForId(id: string) {
  return TOPICS.find((topic) => slug(topic.subject) === id || topic.key === id);
}

export async function debateTakes(subjectId: string) {
  const topic = topicForId(subjectId);
  if (!topic) return null;
  const { rows } = await q<TakeRow>(
    `SELECT id, title, score, greatest(descendants, 0) AS comments
     FROM hackernews
     WHERE type = 'story'
       AND deleted = 0
       AND dead = 0
       AND time >= (SELECT max(time) FROM hackernews) - INTERVAL 7 DAY
       AND (${tokenWhere(topic)})
     ORDER BY score DESC
     LIMIT 10`,
    ["hackernews"]
  );
  const positive = /(launch|released|introducing|show hn|faster|stable|production|open source|new)/i;
  const negative = /(why|against|problem|incident|fails|broken|deprecated|security|postmortem|cost)/i;
  const toLink = (row: TakeRow): EvidenceLink => ({
    title: row.title,
    url: hnItemUrl(row.id),
    source: "hn",
    score: row.score,
    comments: row.comments,
  });
  const agree = rows.filter((row) => positive.test(row.title)).map(toLink).slice(0, 3);
  const dispute = rows.filter((row) => negative.test(row.title)).map(toLink).slice(0, 3);
  const fallback = rows.map(toLink);
  const outlier = rows.toSorted((a, b) => b.comments - a.comments)[0];
  return {
    agree: (agree.length ? agree : fallback.slice(0, 2)).slice(0, 3),
    dispute: (dispute.length ? dispute : fallback.slice(2, 4)).slice(0, 3),
    outlier: outlier ? toLink(outlier) : undefined,
  };
}
