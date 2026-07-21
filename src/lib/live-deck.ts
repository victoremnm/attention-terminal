// Live Daily Skinny deck (issue #28). Assembles a small, varied deck from live
// ClickHouse reads — each card carries the EXACT query behind it (q()'s provenance),
// so the flip-to-view-SQL affordance shows a real, runnable statement, never a mock.
// Cards: real-builders (dev-scatter) + a talk-vs-code divergence for today's loudest
// subject + a star-breakout candles for today's top repo.

import { q } from "./queries";
import { realBuildersDeck } from "./real-builders";
import { SkinnyDeckSchema, type SkinnyCard, type SkinnyDeckPayload } from "./render-payload";
import { divergenceVerdict, seriesVerdict } from "./verdicts";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function realBuildersCard(): Promise<SkinnyCard | null> {
  const deck = await realBuildersDeck("7d");
  return deck.cards[0] ?? null;
}

async function divergenceCard(): Promise<SkinnyCard | null> {
  const top = await q<{ subject: string }>(
    `SELECT subject
     FROM daily_skinny_subject_hourly
     WHERE hour >= now() - INTERVAL 7 DAY
     GROUP BY subject
     HAVING sum(talk_threads) > 0
     ORDER BY sum(talk_threads) DESC
     LIMIT 1`,
    ["daily_skinny_subject_hourly"]
  );
  const subject = top.rows[0]?.subject;
  if (!subject) return null;

  const series = await q<{ day: string; talk: string; code: string }>(
    `SELECT toDate(hour) AS day, sum(talk_threads) AS talk, sum(code_score) AS code
     FROM daily_skinny_subject_hourly
     WHERE subject = {subject:String} AND hour >= now() - INTERVAL 14 DAY
     GROUP BY day
     ORDER BY day`,
    ["daily_skinny_subject_hourly"],
    { subject }
  );
  const days = series.rows.map((r) => r.day);
  const talk = series.rows.map((r) => Number(r.talk));
  const code = series.rows.map((r) => Number(r.code));
  if (!days.length) return null;

  const v = divergenceVerdict(talk, code);
  return {
    id: `divergence-${subject}`,
    subject,
    verdict: v.state,
    metric: String(v.metric),
    metricLabel: v.metricLabel,
    caption: `${subject}: HN talk vs GitHub code over 14 days. ${v.detail}`.slice(0, 320),
    sources: `${sum(talk)} talk · ${sum(code)} code · 14d`,
    visual: { kind: "divergence", days, talk, code },
    query: { sql: series.provenance.sql, rowsRead: series.provenance.rowsRead ?? 0, elapsedMs: series.provenance.elapsedMs },
  };
}

async function candlesCard(): Promise<SkinnyCard | null> {
  const top = await q<{ repo_name: string }>(
    `SELECT repo_name
     FROM gh_repo_daily
     WHERE day >= today() - 7 AND repo_name != ''
     GROUP BY repo_name
     HAVING sum(stars) > 0
     ORDER BY sum(stars) DESC
     LIMIT 1`,
    ["gh_repo_daily"]
  );
  const repo = top.rows[0]?.repo_name;
  if (!repo) return null;

  const series = await q<{ day: string; stars: string }>(
    `SELECT day, sum(stars) AS stars
     FROM gh_repo_daily
     WHERE repo_name = {repo:String} AND day >= today() - 14
     GROUP BY day
     ORDER BY day`,
    ["gh_repo_daily"],
    { repo }
  );
  const days = series.rows.map((r) => r.day);
  const values = series.rows.map((r) => Number(r.stars));
  if (!days.length) return null;

  const v = seriesVerdict(values);
  return {
    id: `candles-${repo}`,
    subject: repo,
    verdict: v.state,
    metric: String(v.metric),
    metricLabel: v.metricLabel,
    caption: `${repo} star velocity over 14 days. Verdict from ${v.rule}.`.slice(0, 320),
    sources: `${sum(values)} stars · 14d`,
    visual: { kind: "candles", days, values },
    query: { sql: series.provenance.sql, rowsRead: series.provenance.rowsRead ?? 0, elapsedMs: series.provenance.elapsedMs },
  };
}

export async function liveSkinnyDeck(): Promise<SkinnyDeckPayload> {
  const cards = (await Promise.all([realBuildersCard(), divergenceCard(), candlesCard()])).filter(
    (c): c is SkinnyCard => c !== null
  );

  return SkinnyDeckSchema.parse({
    type: "skinny-deck",
    dateStr: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    cards,
  });
}
