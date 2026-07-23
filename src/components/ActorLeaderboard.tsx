import type { ActorLeaderboardRow } from "@/lib/queries";

function formatCount(value: number) {
  return value.toLocaleString();
}

function ActorLeaderboardTable({
  rows,
  scoreHint,
}: {
  rows: Array<ActorLeaderboardRow & { group: "Human" | "Bot" }>;
  scoreHint: string;
}) {
  return (
    <section className="actor-leaderboard-table">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-400">Prolific actors</h2>
        <span className="mono text-[11px] text-zinc-500" title={scoreHint}>
          {rows.length ? `showing ${rows.length}` : "no rows"}
        </span>
      </div>
      <p className="mb-3 mono text-[11px] text-zinc-500">{scoreHint}</p>
      <div className="table-responsive">
        <table className="telemetry-table actor-leaderboard-grid">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Actor</th>
              <th>Group</th>
              <th className="text-right" title={scoreHint}>
                Score
              </th>
              <th className="text-right">Events</th>
              <th className="text-right">Repos</th>
              <th className="text-right">Pushes</th>
              <th className="text-right">PRs opened</th>
              <th className="text-right">PRs merged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.group}:${row.actor_login}`}>
                <td className="mono text-zinc-500">{index + 1}</td>
                <td>
                  <a
                    href={`https://github.com/${encodeURIComponent(row.actor_login)}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open ${row.actor_login} on GitHub`}
                    className="actor-leaderboard-link"
                  >
                    {row.actor_login}
                  </a>
                </td>
                <td>
                  <span className={`actor-leaderboard-pill actor-leaderboard-pill-${row.group.toLowerCase()}`}>{row.group}</span>
                </td>
                <td className="mono text-right text-amber-300" title={scoreHint}>
                  {row.score.toFixed(1)}
                </td>
                <td className="mono text-right">{formatCount(row.events)}</td>
                <td className="mono text-right">{formatCount(row.repos)}</td>
                <td className="mono text-right">{formatCount(row.pushes)}</td>
                <td className="mono text-right">{formatCount(row.prs_opened)}</td>
                <td className="mono text-right">{formatCount(row.prs_merged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ActorLeaderboardCard({
  humans,
  bots,
}: {
  humans: ActorLeaderboardRow[];
  bots: ActorLeaderboardRow[];
}) {
  return (
    <div className="tk-card actor-leaderboard-card">
      <div className="actor-leaderboard-head">
        <div>
          <p className="skinny-kicker mono">ACTOR_LEADERBOARD</p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-100">Prolific actors over the last 24h</h2>
        </div>
        <p className="mono text-[11px] text-zinc-500">humans + bots split for signal quality</p>
      </div>

      <ActorLeaderboardTable
        rows={[
          ...humans.map((row) => ({ ...row, group: "Human" as const })),
          ...bots.map((row) => ({ ...row, group: "Bot" as const })),
        ]}
        scoreHint="Human score is weighted from events, repos, pushes, and PRs. Bot score equals raw events."
      />
    </div>
  );
}

export const ActorLeaderboardSurface = ActorLeaderboardCard;
