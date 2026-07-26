import { clickhouse, ensureTablesExist, queryWithRetry } from "./clickhouse";

export interface ActorLeaderboardItem {
  actor_login: string;
  actor_id: number;
  is_bot: number;
  pushes: number;
  commits: number;
  prs_opened: number;
  prs_merged: number;
  issues_opened: number;
  repos_contributed_to: number;
  score: number;
}

export interface GetActorLeaderboardOptions {
  windowDays?: number;
  limit?: number;
  isBot?: boolean | number;
}

export interface ActorLeaderboardResult {
  humans: ActorLeaderboardItem[];
  bots: ActorLeaderboardItem[];
  provenance: {
    sourceTable: string;
    windowDays: number;
    scoreFormula: string;
  };
}

export async function getActorLeaderboard(
  options: GetActorLeaderboardOptions = {}
): Promise<ActorLeaderboardResult> {
  const windowDays = options.windowDays ?? 7;
  const limit = options.limit ?? 10;
  const targetTable = "curated.gh_actor_daily_rollup";

  await ensureTablesExist([targetTable]);

  const fetchForBotStatus = async (isBotVal: number): Promise<ActorLeaderboardItem[]> => {
    const query = `
      SELECT
        actor_login,
        toUInt64(any(actor_id)) AS actor_id,
        toUInt8(${isBotVal}) AS is_bot,
        toUInt32(sum(pushes)) AS pushes,
        toUInt32(sum(commits)) AS commits,
        toUInt32(sum(prs_opened)) AS prs_opened,
        toUInt32(sum(prs_merged)) AS prs_merged,
        toUInt32(sum(issues_opened)) AS issues_opened,
        toUInt32(sum(repos_contributed_to)) AS repos_contributed_to,
        toUInt32(
          sum(pushes) * 2 +
          sum(commits) * 1 +
          sum(prs_opened) * 3 +
          sum(prs_merged) * 5 +
          sum(issues_opened) * 2
        ) AS score
      FROM ${targetTable}
      WHERE day >= today() - INTERVAL ${windowDays} DAY
        AND is_bot = ${isBotVal}
      GROUP BY actor_login
      ORDER BY score DESC, actor_login ASC
      LIMIT ${limit}
    `;

    const rows = await queryWithRetry(async () => {
      const res = await clickhouse.query({ query, format: "JSONEachRow" });
      return res.json<Record<string, any>>();
    });

    return rows.map((r) => ({
      actor_login: String(r.actor_login),
      actor_id: Number(r.actor_id ?? 0),
      is_bot: Number(r.is_bot ?? isBotVal),
      pushes: Number(r.pushes ?? 0),
      commits: Number(r.commits ?? 0),
      prs_opened: Number(r.prs_opened ?? 0),
      prs_merged: Number(r.prs_merged ?? 0),
      issues_opened: Number(r.issues_opened ?? 0),
      repos_contributed_to: Number(r.repos_contributed_to ?? 0),
      score: Number(r.score ?? 0),
    }));
  };

  let humans: ActorLeaderboardItem[] = [];
  let bots: ActorLeaderboardItem[] = [];

  if (options.isBot !== undefined) {
    const isBotVal = options.isBot === true || options.isBot === 1 ? 1 : 0;
    if (isBotVal === 1) {
      bots = await fetchForBotStatus(1);
    } else {
      humans = await fetchForBotStatus(0);
    }
  } else {
    [humans, bots] = await Promise.all([fetchForBotStatus(0), fetchForBotStatus(1)]);
  }

  return {
    humans,
    bots,
    provenance: {
      sourceTable: targetTable,
      windowDays,
      scoreFormula: "pushes * 2 + commits * 1 + prs_opened * 3 + prs_merged * 5 + issues_opened * 2",
    },
  };
}
