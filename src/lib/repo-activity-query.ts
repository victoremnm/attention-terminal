export type RepoWindow = "1d" | "7d" | "30d" | "td";
export type RepoActivitySort =
  | "events"
  | "actors"
  | "pushes"
  | "commits"
  | "stars"
  | "forks"
  | "prsOpened"
  | "prsMerged";
export type RepoActivityDirection = "asc" | "desc";

export interface RepoActivityOptions {
  limit?: number;
  offset?: number;
  sort?: RepoActivitySort;
  direction?: RepoActivityDirection;
  search?: string;
}

export interface NormalizedRepoActivityOptions {
  limit: number;
  offset: number;
  sort: RepoActivitySort;
  direction: RepoActivityDirection;
  search: string;
}

export interface RepoActivityRequest {
  window: RepoWindow;
  options: NormalizedRepoActivityOptions;
}

const WINDOWS = new Set<RepoWindow>(["1d", "7d", "30d", "td"]);
const SORTS = new Set<RepoActivitySort>([
  "events",
  "actors",
  "pushes",
  "commits",
  "stars",
  "forks",
  "prsOpened",
  "prsMerged",
]);

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;
const MAX_SEARCH_LENGTH = 100;

function invalid(message: string): never {
  throw new Error(message);
}

function validateInteger(value: number, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`${name} must be an integer between ${min} and ${max}`);
  }
}

export function normalizeRepoActivityOptions(
  input: RepoActivityOptions | number = {}
): NormalizedRepoActivityOptions {
  const options = typeof input === "number" ? { limit: input } : input;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  const sort = options.sort ?? "events";
  const direction = options.direction ?? "desc";
  const search = options.search?.trim() ?? "";

  validateInteger(limit, "limit", 1, MAX_LIMIT);
  validateInteger(offset, "offset", 0, MAX_OFFSET);
  if (!SORTS.has(sort)) invalid("sort is not supported");
  if (direction !== "asc" && direction !== "desc") invalid("direction must be asc or desc");
  if (search.length > MAX_SEARCH_LENGTH) invalid(`search must be at most ${MAX_SEARCH_LENGTH} characters`);

  return { limit, offset, sort, direction, search };
}

function parseInteger(value: string | null, name: string) {
  if (value === null || !/^\d+$/.test(value)) invalid(`${name} must be a non-negative integer`);
  return Number(value);
}

export function parseRepoActivityRequest(searchParams: URLSearchParams): RepoActivityRequest {
  const rawWindow = searchParams.get("window") ?? "1d";
  if (!WINDOWS.has(rawWindow as RepoWindow)) invalid("window is not supported");

  const limit = searchParams.has("limit") ? parseInteger(searchParams.get("limit"), "limit") : undefined;
  const offset = searchParams.has("offset") ? parseInteger(searchParams.get("offset"), "offset") : undefined;
  const sort = (searchParams.get("sort") ?? undefined) as RepoActivitySort | undefined;
  const direction = (searchParams.get("direction") ?? undefined) as RepoActivityDirection | undefined;
  const search = searchParams.get("search") ?? undefined;

  return {
    window: rawWindow as RepoWindow,
    options: normalizeRepoActivityOptions({ limit, offset, sort, direction, search }),
  };
}

export const REPO_ACTIVITY_DEFAULT_LIMIT = DEFAULT_LIMIT;
