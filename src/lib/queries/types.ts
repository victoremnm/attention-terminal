import type { DevPoint } from "../render-payload";
import type {
  NormalizedRepoActivityOptions,
  RepoActivityOptions,
  RepoActivitySort,
  RepoWindow,
} from "../repo-activity-query";

export type { RepoActivityDirection, RepoActivityOptions, RepoActivitySort, RepoWindow } from "../repo-activity-query";

export interface Provenance {
  sql: string;
  elapsedMs: number;
  rowsRead?: number;
  tables: string[];
}

export interface QueryResult<T> {
  data: T;
  sql: string;
  rowsRead: number;
  elapsedMs: number;
}

export interface TickerCard {
  kicker: string;
  name: string;
  metric: string;
  delta?: string;
  stats?: Array<{ label: string; value: string; tone?: "hot" | "muted" }>;
  spark?: number[];
  href?: string;
  repoName?: string;
}

export interface ActorLeaderboardRow {
  actor_login: string;
  events: number;
  repos: number;
  pushes: number;
  prs_opened: number;
  prs_merged: number;
  score: number;
}

export interface ActorLeaderboard {
  humans: ActorLeaderboardRow[];
  bots: ActorLeaderboardRow[];
  provenance: Provenance[];
}

export interface TickerLanes {
  newRepos: TickerCard[];
  topForked: TickerCard[];
  shippingVelocity: TickerCard[];
  starBreakouts: TickerCard[];
  risingStories: TickerCard[];
  actors: ActorLeaderboard;
  provenance: Provenance[];
  fetchedAt: string;
}

export interface DailySeries {
  days: string[];
  provenance: Provenance;
}

export interface RepoWindowRow {
  repo_name: string;
  owner: string;
  description: string;
  language: string;
  topics: string[];
  github_stars: number;
  events: number;
  actors: number;
  pushes: number;
  commits: number;
  stars: number;
  forks: number;
  prsOpened: number;
  prsMerged: number;
  spark: number[];
}

export interface RepoActivityProof {
  queryId: "repo_activity_window";
  params: NormalizedRepoActivityOptions;
  sourceTables: ["gh_repo_daily", "gh_repo_metadata"];
}

export interface RepoActivityResult extends QueryResult<RepoWindowRow[]> {
  proof: RepoActivityProof;
}

export type DevScatterWindow = "7d" | "30d";

export interface DevScatterResult extends QueryResult<DevPoint[]> {
  note?: string;
  keptCount: number;
}
