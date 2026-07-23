import type { ActorLeaderboardRow } from "@/lib/queries";

function formatCount(value: number) {
  return value.toLocaleString();
}

function ActorLeaderboardTable({
  title,
  rows,
}: {
  title: string;
  rows: ActorLeaderboardRow[];
}) {
  return (
    <section className="actor-leaderboard-table">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-400">{title}</h2>
        <span className="mono text-[11px] text-zinc-500">{rows.length ? `showing ${rows.length}` : "no rows"}</span>
      </div>
      <div className="table-responsive">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Actor</th>
              <th className="text-right">Score</th>
              <th className="text-right">Events</th>
              <th className="text-right">Repos</th>
              <th className="text-right">Pushes</th>
              <th className="text-right">PRs opened</th>
              <th className="text-right">PRs merged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.actor_login}>
                <td>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="mono text-[11px] text-zinc-500">{index + 1}</span>
                    <a
                      href={`https://github.com/${encodeURIComponent(row.actor_login)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-zinc-100 hover:text-cyan-300 hover:underline"
                    >
                      {row.actor_login}
                    </a>
                  </div>
                </td>
                <td className="mono text-right text-amber-300">{row.score.toFixed(1)}</td>
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

      <ActorLeaderboardTable title="Prolific humans" rows={humans} />

      {bots.length > 0 && <ActorLeaderboardTable title="Automation / bots" rows={bots} />}
    </div>
  );
}

export const ActorLeaderboardSurface = ActorLeaderboardCard;
