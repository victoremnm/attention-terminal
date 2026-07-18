// Verdict derivation. The vocabulary is fixed (docs/ANSWER-GRAMMAR.md); every
// verdict cites its threshold so nothing on screen is unexplainable.

export type Verdict =
  | "ACCELERATING"
  | "PEAKING"
  | "COOLING"
  | "DORMANT"
  | "BREAKOUT"
  | "DIVERGENT";

export interface VerdictResult {
  state: Verdict;
  // The single load-bearing number shown on the tile (e.g. 3.2 for "3.2x baseline")
  metric: number;
  metricLabel: string;
  // Threshold rule, cited verbatim in the tile tooltip
  rule: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Single-series verdict: last-7-day daily average vs the prior days' average.
 *   sum < 10            -> DORMANT
 *   ratio >= 3          -> BREAKOUT
 *   ratio >= 1.5        -> ACCELERATING
 *   ratio <= 0.6        -> COOLING
 *   else                -> PEAKING if the recent window contains the series max,
 *                          otherwise COOLING
 */
export function seriesVerdict(daily: number[]): VerdictResult {
  const total = daily.reduce((a, b) => a + b, 0);
  if (total < 10) {
    return { state: "DORMANT", metric: total, metricLabel: "mentions/30d", rule: "fewer than 10 data points in 30 days" };
  }
  const recent = daily.slice(-7);
  const prior = daily.slice(0, -7);
  const ratio = avg(recent) / Math.max(avg(prior), 0.01);
  const r = Math.round(ratio * 10) / 10;
  if (ratio >= 3) return { state: "BREAKOUT", metric: r, metricLabel: "x baseline", rule: "7d avg >= 3x prior-23d avg" };
  if (ratio >= 1.5) return { state: "ACCELERATING", metric: r, metricLabel: "x baseline", rule: "7d avg >= 1.5x prior-23d avg" };
  if (ratio <= 0.6) return { state: "COOLING", metric: r, metricLabel: "x baseline", rule: "7d avg <= 0.6x prior-23d avg" };
  const atPeak = Math.max(...recent) >= Math.max(...daily);
  return atPeak
    ? { state: "PEAKING", metric: r, metricLabel: "x baseline", rule: "steady (0.6-1.5x) with the 30d maximum inside the last 7d" }
    : { state: "COOLING", metric: r, metricLabel: "x baseline", rule: "steady (0.6-1.5x), past its 30d maximum" };
}

/**
 * Divergence verdict for talk (HN) vs code (GitHub):
 * DIVERGENT when the two feeds' 7d-vs-prior ratios disagree by >= 2x in either
 * direction; otherwise falls back to the stronger single-series verdict.
 */
export function divergenceVerdict(talk: number[], code: number[]): VerdictResult & { detail: string } {
  const ratioOf = (xs: number[]) => avg(xs.slice(-7)) / Math.max(avg(xs.slice(0, -7)), 0.01);
  const talkR = ratioOf(talk);
  const codeR = ratioOf(code);
  const spread = talkR / Math.max(codeR, 0.01);
  if (spread >= 2 || spread <= 0.5) {
    const led = spread >= 2 ? "talk-led: chatter is outrunning code" : "code-led: shipping is outrunning chatter";
    return {
      state: "DIVERGENT",
      metric: Math.round(spread * 10) / 10,
      metricLabel: "x talk/code spread",
      rule: "talk and code 7d-vs-baseline ratios disagree by >= 2x",
      detail: led,
    };
  }
  const base = seriesVerdict(talk.map((t, i) => t + (code[i] ?? 0)));
  return { ...base, detail: "talk and code moving together" };
}
