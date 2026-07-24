// Request parsing/validation for the active-contribution ranking API (issue
// #139/#140). Mirrors the shape of repo-activity-query.ts so both "ranking
// families" share the same validate-before-query discipline and error style.
import type { ActiveContributionSort, ActiveContributionWindow } from "./queries";

export interface ActiveContributionRequest {
  window: ActiveContributionWindow;
  sort: ActiveContributionSort;
  limit: number;
}

const WINDOWS = new Set<ActiveContributionWindow>(["1d", "7d", "30d"]);
const SORTS = new Set<ActiveContributionSort>([
  "top_forks",
  "top_pushes",
  "top_commits",
  "pr_velocity",
  "active_builders",
  "commits",
  "pushes",
]);

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function invalid(message: string): never {
  throw new Error(message);
}

function parseInteger(value: string, name: string) {
  if (!/^\d+$/.test(value)) invalid(`${name} must be a non-negative integer`);
  return Number(value);
}

export function parseActiveContributionRequest(searchParams: URLSearchParams): ActiveContributionRequest {
  const rawWindow = searchParams.get("window") ?? "1d";
  if (!WINDOWS.has(rawWindow as ActiveContributionWindow)) invalid("window is not supported");

  const rawSort = searchParams.get("sort") ?? "commits";
  if (!SORTS.has(rawSort as ActiveContributionSort)) invalid("sort is not supported");

  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : parseInteger(rawLimit, "limit");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    invalid(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return {
    window: rawWindow as ActiveContributionWindow,
    sort: rawSort as ActiveContributionSort,
    limit,
  };
}

export const ACTIVE_CONTRIBUTION_DEFAULT_LIMIT = DEFAULT_LIMIT;
export const ACTIVE_CONTRIBUTION_MAX_LIMIT = MAX_LIMIT;
