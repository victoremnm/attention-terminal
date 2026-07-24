// Query antipattern analyzer (issue #236).
//
// Pure, dependency-free SQL-introspection that flags the timeout-causing
// antipatterns documented in docs/architecture/LESSONS-LEARNED-500-TIMEOUTS-
// AND-GRANULE-OPTIMIZATION.md plus the new failing-query shape
// (lower(title) LIKE '%htmx%' on raw default.hackernews — see issue #236).
//
// Design: the analyzer pattern-matches against SQL text rather than parsing
// a real AST. That keeps it dependency-free, fast, and safe to run both
// server-side (inside the runReadOnlyQuery pre-flight gate) and at query-log
// read time (the /analysis dashboard re-runs it on every row to badge which
// rule a query hit). False negatives are acceptable — false positives are
// not, because they block valid agent queries in production. Every rule is
// therefore narrowly scoped to the documented symptom, and the curated
// production queries in src/lib/queries.ts are covered by a regression test
// that asserts no rule fires on them.

export type AntipatternSeverity = "P1" | "P2" | "P3";

export interface AntipatternHit {
  /** Stable identifier surfaced in dashboards + tests. */
  id: string;
  /** P1 = blocks the query pre-flight (timeout cause). P2/P3 = log-only. */
  severity: AntipatternSeverity;
  /** Short human-readable title. */
  title: string;
  /** Why this causes timeouts — shown to the model in the gate error. */
  why: string;
  /** The offending substring from the query, for the dashboard badge. */
  evidence: string;
  /** One concrete fix the model can apply. */
  fix: string;
}

const KNOWN_RAW_TABLES = [
  "default.hackernews",
  "raw.hackernews",
  "hackernews",
  "raw.github_events",
  "github_events",
  "default.gh_repo_activity_feed",
  "gh_repo_activity_feed",
];

const TIME_PREDICATE_COLUMNS = ["time", "created_at", "event_time", "hour", "date", "day"];

function normalizeForMatch(sql: string): string {
  // Strip single-line -- and inline /* */ comments, collapse whitespace.
  // Preserve quoted string literals (so LIKE '%foo%' stays intact) — quotes
  // are only stripped where they wrap around identifiers, not in predicates.
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[^]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTables(sql: string): { table: string; qualified: string }[] {
  const refs: { table: string; qualified: string }[] = [];
  const re = /\b(?:from|join)\s+([`"]?)([A-Za-z_][\w$]*)\1(?:\.([`"]?)([A-Za-z_][\w$]*)\3)?/gi;
  for (const m of sql.matchAll(re)) {
    const qualified = m[4] ? `${m[2]}.${m[4]}` : m[2];
    refs.push({ table: m[4] ?? m[2], qualified });
  }
  return refs;
}

function hasWithBoundMax(sql: string, columnName: string): boolean {
  // True when the query uses a `WITH (SELECT max(<col>) ...) AS <name>` form
  // AND a WHERE predicate references <name>. The bound scalar constants in
  // the lessons-learned doc.
  const re = new RegExp(`\\bwith\\b[\\s\\S]{0,400}?\\(\\s*select\\s+max\\s*\\(\\s*${columnName}\\s*\\)\\s+from\\s+[\\s\\S]{1,200}?\\)\\s+as\\s+([A-Za-z_][\\w$]*)`, "i");
  const m = sql.match(re);
  if (!m || !m[1]) return false;
  const alias = m[1];
  // Confirm the alias is referenced in a predicate; otherwise it's just dead.
  const aliasRe = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return aliasRe.test(sql.replace(re, " "));
}

function hasTimePredicate(sql: string, tableBare: string): boolean {
  // Look for a `WHERE ... <time_col> > now() - INTERVAL n ...` or a `WHERE
  // ... <time_col> >= '<date>'` predicate mentioning the bare table's known
  // time column. The.numeric raw tables in this repo (hackernews.time,
  // gh_repo_activity_feed.created_at, github_events.created_at, gh_repo_hourly.hour)
  // are the key granule-pruning hooks.
  const lower = sql.toLowerCase();
  for (const col of TIME_PREDICATE_COLUMNS) {
    if (!lower.includes(col)) continue;
    // Predicate: col >= 'date' OR col > now() - INTERVAL n (UNIT) OR col > <cte-alias>
    const predRe = new RegExp(`\\b${col}\\b\\s*(>=|>|<=|<|between)\\s*[''0-9a-z]`, "i");
    if (predRe.test(sql)) return true;
    // also accept correlated-to-its-own-max (the WITH-binding above is the
    // canonical good form): `hour > max_h - INTERVAL 24 HOUR`.
    const viaMaxRe = new RegExp(`\\b${col}\\b\\s*(>=|>|<)\\s*[a-z_][\\w$.]*(?:\\s*-\\s*interval)?`, "i");
    if (viaMaxRe.test(sql)) return true;
    // BETWEEN x AND y on the time column.
    const betweenRe = new RegExp(`\\b${col}\\b\\s+between\\b`, "i");
    if (betweenRe.test(sql)) return true;
  }
  void tableBare; // reserved for future per-table column mapping
  return false;
}

function findLeadingWildcardLike(sql: string): AntipatternHit | null {
  // `lower(col) LIKE '%x%'` / `col LIKE '%x'` / `ILIKE '%x%'` on String columns.
  // The leading `%` defeats tokenbf/ngrambf skip indexes and forces a full
  // granule scan. This is the exact failing query from the production timeout
  // (issue #236). Match the LIKE/ILIKE pattern argument directly — the `lower()`
  // wrapper doesn't change the impact, and is caught separately by the
  // function-wrapped-predicate rule when it touches an indexed column.
  // Capture the full LIKE/ILIKE string argument so we can inspect its first
  // char. Regex is non-greedy on the inner content so two adjacent LIKE
  // patterns in one WHERE (`a LIKE '%x%' OR b LIKE '%y%'`) both iterate.
  const re = /\b(ILIKE|LIKE)\s+'([^']*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const pattern = m[2];
    if (!pattern || !pattern.startsWith("%")) continue;
    // Grab the operand just before the LIKE — a column reference or a
    // function(col) call. Best-effort, for the dashboard evidence string.
    const beforeRe = /([A-Za-z_][\w.]*|\w+\(\s*[A-Za-z_][\w.]*\s*\))\s*$/i;
    const prefix = sql.slice(0, m.index);
    const operandMatch = prefix.match(beforeRe);
    const operand = operandMatch ? operandMatch[1] : "<col>";
    return {
      id: "leading-wildcard-like",
      severity: "P1",
      title: "Leading-wildcard LIKE defeats skip indexes",
      why: `LIKE '${m[2]}…' forces a full granule scan — the leading % can't be tokenized, so tokenbf/ngrambf skipping indexes are skipped and ClickHouse reads every row on ${operand}. On a raw table like default.hackernews (~12M rows) this hits the 30s execution timeout.`,
      evidence: m[0],
      fix: "Use a tokenized search the skip index can serve: position(<col>, '<needle>') > 0 (or tokenbf_v1 with ngrambf for multi-word). For 'is the subject trending' questions, read hn_hourly (subject rollup) instead of the raw table.",
    };
  }
  return null;
}

function findFunctionWrappedPredicate(sql: string): AntipatternHit | null {
  // `WHERE lower(col) = 'x'` / `WHERE toString(col) = …` — wrapping an
  // indexed column in a function disables primary-key granule pruning AND
  // skip-index lookup. Only fire on the primary time/identity columns the
  // repo indexes by; loose pattern otherwise false-positives on legitimate
  // `where lower(actor_login) = 'foo'` (which is fine — that column isn't
  // the granule index).
  const indexedCols = ["time", "created_at", "hour", "date", "day", "event_time", "id", "repo_name"];
  for (const col of indexedCols) {
    const re = new RegExp(`\\bwhere\\b[^;]{0,500}?\\b(?:lower|toLower|toString|toUInt|toInt|toFloat|toDate|toDateTime)\\(\\s*${col}\\b`, "i");
    const m = sql.match(re);
    if (m) {
      return {
        id: "function-wrapped-predicate",
        severity: "P1",
        title: `Function-wrapped predicate on indexed column \`${col}\``,
        why: `Wrapping \`${col}\` in lower()/toString()/to*() in the WHERE clause disables primary-key granule pruning and the skip index on that column. Every granule is read.`,
        evidence: m[0],
        fix: `Apply the function to the *constant* side instead: e.g. WHERE ${col} = toDateTime('2026-07-01 00:00:00') — or drop the wrapper and compare against a literal. Store/retrieve ${col} in its native typed form.`,
      };
    }
  }
  return null;
}

function findCorrelatedScalarSubquery(sql: string): AntipatternHit | null {
  // `WHERE col > (SELECT max(col) FROM same_table) - INTERVAL n UNIT`
  // without a WITH-bound scalar — re-evaluated per pipeline stage (lesson #2).
  // Detect "WHERE ... (SELECT max(<col>) FROM <table>) …" with no preceding
  // WITH-binding for that same max expression.
  const re = /\bwhere\b[^;]{0,800}?\(\s*select\s+max\s*\(\s*([A-Za-z_][\w]*)\s*\)\s+from\s+([A-Za-z_][\w.]+)\s*\)/gi;
  for (const m of sql.matchAll(re)) {
    const col = m[1];
    const table = m[2];
    // Was the max() bound in a WITH clause? If so this is the good form.
    if (hasWithBoundMax(sql, col)) return null;
    return {
      id: "correlated-scalar-subquery",
      severity: "P1",
      title: "Correlated scalar subquery in WHERE — re-evaluated per stage",
      why: `WHERE ... (SELECT max(${col}) FROM ${table}) is evaluated repeatedly across query pipelines instead of once. On large tables this turns a 10ms query into a 30s timeout (lesson #2 in LESSONS-LEARNED-500-TIMEOUTS).`,
      evidence: m[0],
      fix: `Bind the scalar once in a WITH clause: WITH (SELECT max(${col}) FROM ${table}) AS max_${col} SELECT ... FROM ${table} WHERE ${col} > max_${col} - INTERVAL n HOUR.`,
    };
  }
  return null;
}

function findRawTableFullScan(sql: string): AntipatternHit | null {
  // `FROM default.hackernews` / `FROM github_events` without a tight time
  // predicate — reads tens of millions of rows. Only fire when the raw
  // table is read AND no time/created_at/hour predicate wraps it.
  const refs = extractTables(sql);
  for (const ref of refs) {
    if (!KNOWN_RAW_TABLES.includes(ref.qualified) && !KNOWN_RAW_TABLES.includes(ref.table)) continue;
    if (hasTimePredicate(sql, ref.table)) continue;
    return {
      id: "raw-table-full-scan",
      severity: "P2",
      title: `Raw-table full scan on \`${ref.qualified}\``,
      why: `Reading ${ref.qualified} without a tight time/created_at predicate forces a full granule scan. ${ref.qualified} holds raw firehose rows; the idx_*_time minmax index is the lifeline — but only when a predicate is present.`,
      evidence: `FROM ${ref.qualified}`,
      fix: `Add a tight time bound to the WHERE: e.g. WHERE time >= now() - INTERVAL 24 HOUR. For 90%+ of "what's happening" questions, read the rollup (hn_hourly / gh_repo_hourly / gh_repo_daily) instead of the raw table.`,
    };
  }
  return null;
}

function findLeftJoinRawEventView(sql: string): AntipatternHit | null {
  // `LEFT JOIN gh_repo_activity_feed ...` for sparkline/aggregation causes
  // multi-GB hash joins over raw events (lesson #1). Detect a LEFT/RIGHT JOIN
  // on the raw event feed.
  const re = /\b(left\s+join|right\s+join)\s+([`"]?)(gh_repo_activity_feed|github_events)(\2)/i;
  const m = sql.match(re);
  if (!m) return null;
  return {
    id: "left-join-raw-event-view",
    severity: "P2",
    title: `LEFT JOIN on raw event feed \`${m[3]}\``,
    why: `Joining ${m[3]} against itself or another table for sparklines/aggregation builds a massive in-memory hash table over tens of millions of rows — the documented cause of the 14.4GB memory-limit overflows.`,
    evidence: m[0],
    fix: "Compute sparklines and aggregations in a single pass using countIf/sumIf over pre-aggregated rollup tables (gh_repo_hourly). Don't join the raw event feed to itself or to other tables.",
  };
}

function findNumericToStringRoundtrip(sql: string): AntipatternHit | null {
  // `toString(round(x)) AS score ... ORDER BY toFloat64(score) DESC`
  // (lesson #4). Detect: a `toString(<numeric fn>) AS <alias>` followed
  // later by `ORDER BY toFloat64(<alias>)`. The inner expression can include
  // one nested balanced paren (round(stars), sum(x), etc.).
  const re = /\btoString\s*\(\s*(?:[^()]|\([^()]*\))+\s*\)\s+as\s+([A-Za-z_][\w]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const alias = m[1];
    const orderRe = new RegExp(`\\border\\s+by\\s+to(?:Float(?:32|64)?|UInt\\d+|Int\\d+|Decimal\\d+)\\s*\\(\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (orderRe.test(sql)) {
      return {
        id: "numeric-to-string-roundtrip",
        severity: "P3",
        title: "Numeric→String→Numeric round-trip during aggregation",
        why: `Formatting a numeric aggregate with toString(round(...)) AS ${alias} allocates a string buffer per row, then re-parsing toFloat64(${alias}) for ORDER BY burns CPU on every row.`,
        evidence: m[0],
        fix: `Keep the aggregate as its native UInt64/Float64 type through the pipeline: just \`AS ${alias}\` and \`ORDER BY ${alias} DESC\`. Format for display only at the final SELECT projection, not earlier.`,
      };
    }
  }
  return null;
}

function findIlikeLeadingWildcard(sql: string): AntipatternHit | null {
  // `ILIKE '%[bot]%'` (lesson #3) — case-insensitive regex per string.
  const re = /\bILIKE\s+'(%[^']*)'/i;
  const m = sql.match(re);
  if (!m) return null;
  return {
    id: "ilike-leading-wildcard",
    severity: "P3",
    title: "Leading-wildcard ILIKE disables granule pruning",
    why: `ILIKE '${m[1]}' triggers case-insensitive regex parsing per string — granule skipping indexes ignore it entirely; high CPU on every row.`,
    evidence: m[0],
    fix: "Use a direct SIMD byte function: endsWith(actor_login, '[bot]') for a suffix check, position(actor_login, '[bot]') > 0 for an infix check. They run on the typed column, no per-row regex allocation.",
  };
}

export function analyzeQueryAntipatterns(rawSql: string): AntipatternHit[] {
  const sql = normalizeForMatch(rawSql);
  const hits: AntipatternHit[] = [];
  for (const fn of [
    findLeadingWildcardLike,
    findFunctionWrappedPredicate,
    findCorrelatedScalarSubquery,
    findRawTableFullScan,
    findLeftJoinRawEventView,
    findNumericToStringRoundtrip,
    findIlikeLeadingWildcard,
  ]) {
    const hit = fn(sql);
    if (hit) hits.push(hit);
  }
  return hits;
}

export function formatAntipatternHint(hits: AntipatternHit[]): string {
  const p1 = hits.filter((h) => h.severity === "P1");
  if (p1.length === 0) return "";
  const lines = p1.map((h) => `- [${h.id}] ${h.title}: ${h.why}\n  Fix: ${h.fix}`);
  return [
    "ClickHouse query blocked by the antipattern analyzer — this query shape has timed out in production. Repair and retry:",
    ...lines,
    "See docs/architecture/QUERY-ANTIPATTERNS.md for the full rule set.",
  ].join("\n");
}

// --- log_comment attribution (run/chat/turn/tool joined back to system.query_log) ---

export interface LogCommentTag {
  runId?: string;
  chatId?: string;
  turn?: number;
  step?: number;
  toolName?: string;
  queryId?: string;
  // Optional: an agent-chosen label like "digest", "repo-drilldown", to mark
  // which curated surface this query feeds. Lets the dashboard group.
  surface?: string;
}

export function buildLogComment(tag: LogCommentTag): string {
  const parts = ["attn"];
  if (tag.runId) parts.push(`run=${tag.runId}`);
  if (tag.chatId) parts.push(`chat=${tag.chatId}`);
  if (typeof tag.turn === "number") parts.push(`turn=${tag.turn}`);
  if (typeof tag.step === "number") parts.push(`step=${tag.step}`);
  if (tag.toolName) parts.push(`tool=${tag.toolName}`);
  if (tag.surface) parts.push(`surface=${tag.surface}`);
  if (tag.queryId) parts.push(`qid=${tag.queryId}`);
  return parts.join(" | ");
}

export interface ParsedLogComment extends LogCommentTag {
  raw: string;
  isAttentionQuery: boolean;
}

export function parseLogComment(raw: string | null | undefined): ParsedLogComment {
  const fallback: ParsedLogComment = { raw: raw ?? "", isAttentionQuery: false };
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("attn")) return { raw: trimmed, isAttentionQuery: false };
  const out: ParsedLogComment = { raw: trimmed, isAttentionQuery: true };
  for (const part of trimmed.split("|").map((p) => p.trim()).slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "run") out.runId = v;
    else if (k === "chat") out.chatId = v;
    else if (k === "turn") out.turn = Number(v);
    else if (k === "step") out.step = Number(v);
    else if (k === "tool") out.toolName = v;
    else if (k === "surface") out.surface = v;
    else if (k === "qid") out.queryId = v;
  }
  return out;
}