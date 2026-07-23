// Pure, storage-agnostic helpers backing the Trending ranking-mode selector,
// sortable/filterable columns, and persisted column preferences (issues
// #135 and #139). Kept dependency-free from React/DOM so it is trivial to
// unit test and so the component only has to wire state <-> these helpers.
//
// `RepoWindowRow`/`ActiveContributionRow` are imported as types only (erased
// at build time) so this stays safe to import from a "use client" component
// without pulling the server-only ClickHouse client into the browser bundle.
import type { ActiveContributionRow, RepoWindowRow } from "./queries";

export type RankingMode = "attention" | "stars" | "forks" | "active-commits" | "active-pushes";

// Which backend serves a mode: "attention" reads /api/trending (issue #137's
// paginated top-100 query, sorted by any of its whitelisted measures);
// "active" reads /api/trending-active (issue #140's anti-noise commits/pushes
// ranking over gh_repo_actor_hourly, unpaginated top-N).
export type RankingSource = "attention" | "active";

export interface RankingModeConfig {
  key: RankingMode;
  label: string;
  source: RankingSource;
  /** Sort field to request from the source's own query contract. */
  querySort: string;
  /** One-line disclosure of the window + measure driving the rank (issue #139 checklist). */
  description: string;
}

export const RANKING_MODES: readonly RankingModeConfig[] = [
  {
    key: "attention",
    label: "Attention",
    source: "attention",
    querySort: "events",
    description: "Combined GitHub + HN event volume in the selected window.",
  },
  {
    key: "stars",
    label: "Stars",
    source: "attention",
    querySort: "stars",
    description: "New star events in the selected window.",
  },
  {
    key: "forks",
    label: "Forks",
    source: "attention",
    querySort: "forks",
    description: "Fork events in the selected window.",
  },
  {
    key: "active-commits",
    label: "Active (commits)",
    source: "active",
    querySort: "commits",
    description: "Distinct commits, excluding zero-commit pushes and idle repos.",
  },
  {
    key: "active-pushes",
    label: "Active (pushes)",
    source: "active",
    querySort: "pushes",
    description: "Substantive push activity only — zero-commit and default-branch noise excluded.",
  },
] as const;

export function modeConfig(mode: RankingMode): RankingModeConfig {
  return RANKING_MODES.find((m) => m.key === mode) ?? RANKING_MODES[0];
}

// --- Column registries -------------------------------------------------

export type AttentionColumnKey =
  | "githubStars"
  | "stars"
  | "forks"
  | "pushes"
  | "commits"
  | "actors"
  | "prsOpened"
  | "prsMerged";

export type ActiveColumnKey =
  | "distinctCommits"
  | "substantivePushBuckets"
  | "pushes"
  | "commits"
  | "humanPushers"
  | "botPushers"
  | "prsOpened"
  | "prsMerged";

export interface ColumnDef<K extends string> {
  key: K;
  label: string;
  hint: string;
}

export const ATTENTION_COLUMNS: readonly ColumnDef<AttentionColumnKey>[] = [
  { key: "githubStars", label: "★ total", hint: "Total GitHub stars on the repo" },
  { key: "stars", label: "+stars", hint: "Star events in this window" },
  { key: "forks", label: "forks", hint: "Fork events in this window" },
  { key: "pushes", label: "pushes", hint: "Push events in this window" },
  { key: "commits", label: "commits", hint: "Commits in this window" },
  { key: "actors", label: "actors", hint: "Distinct actors active in this window" },
  { key: "prsOpened", label: "PRs opened", hint: "Pull requests opened in this window" },
  { key: "prsMerged", label: "PRs merged", hint: "Pull requests merged in this window" },
] as const;

export const ACTIVE_COLUMNS: readonly ColumnDef<ActiveColumnKey>[] = [
  { key: "distinctCommits", label: "distinct commits", hint: "Distinct commits, zero-commit pushes excluded" },
  { key: "substantivePushBuckets", label: "substantive pushes", hint: "Actor/repo/hour buckets with a push AND a commit" },
  { key: "pushes", label: "raw pushes", hint: "Raw push count, including zero-commit noise" },
  { key: "commits", label: "raw commits", hint: "Raw commit count" },
  { key: "humanPushers", label: "human pushers", hint: "Distinct non-bot actors who pushed" },
  { key: "botPushers", label: "bot pushers", hint: "Distinct [bot]-suffixed actors who pushed" },
  { key: "prsOpened", label: "PRs opened", hint: "Pull requests opened in this window" },
  { key: "prsMerged", label: "PRs merged", hint: "Pull requests merged in this window" },
] as const;

export const DEFAULT_ATTENTION_COLUMNS: readonly AttentionColumnKey[] = ["pushes", "commits", "actors"];
export const DEFAULT_ACTIVE_COLUMNS: readonly ActiveColumnKey[] = [
  "distinctCommits",
  "substantivePushBuckets",
  "humanPushers",
];

// --- Persisted preferences ---------------------------------------------

export interface RankingsPreferences {
  mode: RankingMode;
  /** Client-side display sort applied to the currently loaded rows. */
  sortField: string;
  sortDirection: "asc" | "desc";
  attentionColumns: AttentionColumnKey[];
  activeColumns: ActiveColumnKey[];
  minStars: number;
  hideBotOnly: boolean;
  requireSubstantiveWork: boolean;
}

export const DEFAULT_PREFERENCES: RankingsPreferences = {
  mode: "attention",
  sortField: "events",
  sortDirection: "desc",
  attentionColumns: [...DEFAULT_ATTENTION_COLUMNS],
  activeColumns: [...DEFAULT_ACTIVE_COLUMNS],
  minStars: 0,
  hideBotOnly: false,
  requireSubstantiveWork: true,
};

const STORAGE_KEY = "attention-terminal:rankings-preferences:v1";

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

export function loadPreferences(storage: MinimalStorage | undefined | null): RankingsPreferences {
  if (!storage) return DEFAULT_PREFERENCES;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(storage: MinimalStorage | undefined | null, prefs: RankingsPreferences): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a non-critical nicety - a full/blocked localStorage
    // (private browsing, quota) must never break the ranking surface.
  }
}

function sanitizeColumns<K extends string>(input: unknown, allowed: readonly K[], fallback: readonly K[]): K[] {
  if (!Array.isArray(input)) return [...fallback];
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<K>();
  const result: K[] = [];
  for (const item of input) {
    if (typeof item === "string" && allowedSet.has(item) && !seen.has(item as K)) {
      seen.add(item as K);
      result.push(item as K);
    }
  }
  return result.length ? result : [...fallback];
}

export function sanitizePreferences(input: unknown): RankingsPreferences {
  if (!input || typeof input !== "object") return DEFAULT_PREFERENCES;
  const raw = input as Partial<RankingsPreferences>;

  const mode: RankingMode = RANKING_MODES.some((m) => m.key === raw.mode)
    ? (raw.mode as RankingMode)
    : DEFAULT_PREFERENCES.mode;

  const sortDirection: "asc" | "desc" =
    raw.sortDirection === "asc" || raw.sortDirection === "desc" ? raw.sortDirection : DEFAULT_PREFERENCES.sortDirection;

  const sortField = typeof raw.sortField === "string" && raw.sortField.length > 0 ? raw.sortField : modeConfig(mode).querySort;

  const attentionColumns = sanitizeColumns(
    raw.attentionColumns,
    ATTENTION_COLUMNS.map((c) => c.key),
    DEFAULT_ATTENTION_COLUMNS
  );
  const activeColumns = sanitizeColumns(
    raw.activeColumns,
    ACTIVE_COLUMNS.map((c) => c.key),
    DEFAULT_ACTIVE_COLUMNS
  );

  const minStars = typeof raw.minStars === "number" && Number.isFinite(raw.minStars) && raw.minStars >= 0 ? raw.minStars : 0;
  const requireSubstantiveWork = typeof raw.requireSubstantiveWork === "boolean" ? raw.requireSubstantiveWork : true;
  const hideBotOnly = typeof raw.hideBotOnly === "boolean" ? raw.hideBotOnly : false;

  return { mode, sortField, sortDirection, attentionColumns, activeColumns, minStars, requireSubstantiveWork, hideBotOnly };
}

// --- Column toggling / reordering (drag-to-reorder alternative: explicit
// up/down controls, which stay fully keyboard- and screen-reader-operable) --

export function toggleColumn<K extends string>(columns: K[], canonicalOrder: readonly K[], key: K): K[] {
  if (columns.includes(key)) {
    return columns.filter((c) => c !== key);
  }
  const next = new Set([...columns, key]);
  return canonicalOrder.filter((k) => next.has(k));
}

export function moveColumn<K extends string>(columns: K[], key: K, direction: -1 | 1): K[] {
  const idx = columns.indexOf(key);
  if (idx === -1) return columns;
  const target = idx + direction;
  if (target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  const tmp = next[idx];
  next[idx] = next[target];
  next[target] = tmp;
  return next;
}

// --- Sorting -------------------------------------------------------------

export function nextSortDirection(
  currentField: string,
  currentDirection: "asc" | "desc",
  clickedField: string
): "asc" | "desc" {
  if (currentField !== clickedField) return "desc";
  return currentDirection === "desc" ? "asc" : "desc";
}

/** Generic comparator for client-side re-sort of an already-loaded row page. */
export function compareByField<T extends Record<string, unknown>>(field: string, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return (a: T, b: T): number => {
    const av = a[field];
    const bv = b[field];
    if (typeof av === "number" && typeof bv === "number") {
      if (av === bv) return 0;
      return av < bv ? -sign : sign;
    }
    const as = String(av ?? "");
    const bs = String(bv ?? "");
    return sign * as.localeCompare(bs);
  };
}

// --- Row projection --------------------------------------------------------
//
// Both ranking sources have a different row shape (RepoWindowRow carries a
// sparkline + repo metadata; ActiveContributionRow carries anti-noise
// commit/push measures and honest "unknown" branch/bot-attribution state).
// These helpers normalize either into one `RankingRowView` the table renders
// uniformly, so the component doesn't need a big mode-conditional JSX fork.

export interface RankingChip {
  key: string;
  label: string;
  value: number;
}

export interface RankingRowView {
  key: string;
  repoName: string;
  owner: string;
  description: string;
  language: string;
  topics: string[];
  githubStars: number;
  spark: number[] | undefined;
  primaryLabel: string;
  primaryValue: number;
  chips: RankingChip[];
  searchText: string;
  /** true when every observed pusher on this repo in-window was a bot account. */
  botOnly: boolean;
}

const ATTENTION_FIELD_LABEL: Record<string, string> = {
  events: "events",
  actors: "actors",
  pushes: "pushes",
  commits: "commits",
  stars: "stars",
  forks: "forks",
  prsOpened: "PRs opened",
  prsMerged: "PRs merged",
};

export function attentionColumnValue(row: RepoWindowRow, key: AttentionColumnKey): number {
  switch (key) {
    case "githubStars":
      return row.github_stars;
    case "stars":
      return row.stars;
    case "forks":
      return row.forks;
    case "pushes":
      return row.pushes;
    case "commits":
      return row.commits;
    case "actors":
      return row.actors;
    case "prsOpened":
      return row.prsOpened;
    case "prsMerged":
      return row.prsMerged;
    default:
      return 0;
  }
}

/** Any RepoActivitySort-shaped field, including "events" which is not a toggleable column. */
export function attentionMeasureValue(row: RepoWindowRow, field: string): number {
  if (field === "events") return row.events;
  return attentionColumnValue(row, field as AttentionColumnKey);
}

export function attentionRowView(
  row: RepoWindowRow,
  sortField: string,
  columns: readonly AttentionColumnKey[]
): RankingRowView {
  return {
    key: row.repo_name,
    repoName: row.repo_name,
    owner: row.owner,
    description: row.description,
    language: row.language,
    topics: row.topics,
    githubStars: row.github_stars,
    spark: row.spark,
    primaryLabel: ATTENTION_FIELD_LABEL[sortField] ?? "events",
    primaryValue: attentionMeasureValue(row, sortField),
    chips: columns.map((key) => ({
      key,
      label: ATTENTION_COLUMNS.find((c) => c.key === key)?.label ?? key,
      value: attentionColumnValue(row, key),
    })),
    searchText: [row.repo_name, row.owner, row.description, row.language, ...row.topics].join(" ").toLowerCase(),
    botOnly: false,
  };
}

export function activeColumnValue(row: ActiveContributionRow, key: ActiveColumnKey): number {
  switch (key) {
    case "distinctCommits":
      return row.distinctCommits;
    case "substantivePushBuckets":
      return row.substantivePushBuckets;
    case "pushes":
      return row.pushes;
    case "commits":
      return row.commits;
    case "humanPushers":
      return row.humanPushers;
    case "botPushers":
      return row.botPushers;
    case "prsOpened":
      return row.prsOpened;
    case "prsMerged":
      return row.prsMerged;
    default:
      return 0;
  }
}

const ACTIVE_FIELD_LABEL: Record<string, string> = {
  commits: "distinct commits",
  pushes: "substantive pushes",
};

/** "commits"/"pushes" map to their anti-noise measures; anything else is a chip column. */
export function activeMeasureValue(row: ActiveContributionRow, field: string): number {
  if (field === "commits") return row.distinctCommits;
  if (field === "pushes") return row.substantivePushBuckets;
  return activeColumnValue(row, field as ActiveColumnKey);
}

export function activeRowView(
  row: ActiveContributionRow,
  sortField: string,
  columns: readonly ActiveColumnKey[]
): RankingRowView {
  return {
    key: row.repoName,
    repoName: row.repoName,
    owner: "",
    description: "",
    language: "",
    topics: [],
    githubStars: 0,
    spark: undefined,
    primaryLabel: ACTIVE_FIELD_LABEL[sortField] ?? "distinct commits",
    primaryValue: activeMeasureValue(row, sortField),
    chips: columns.map((key) => ({
      key,
      label: ACTIVE_COLUMNS.find((c) => c.key === key)?.label ?? key,
      value: activeColumnValue(row, key),
    })),
    searchText: row.repoName.toLowerCase(),
    botOnly: row.botPushers > 0 && row.humanPushers === 0,
  };
}
