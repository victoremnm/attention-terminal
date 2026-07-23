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
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-1 text-left">
          <thead className="mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium text-right">Score</th>
              <th className="px-3 py-2 font-medium text-right">Events</th>
              <th className="px-3 py-2 font-medium text-right">Repos</th>
              <th className="px-3 py-2 font-medium text-right">Pushes</th>
              <th className="px-3 py-2 font-medium text-right">PRs opened</th>
              <th className="px-3 py-2 font-medium text-right">PRs merged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.actor_login} className="rounded-xl bg-black/15">
                <td className="rounded-l-xl px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="mono text-[11px] text-zinc-500">{index + 1}</span>
                    <span className="truncate text-sm font-medium text-zinc-100">{row.actor_login}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right mono text-amber-300">{row.score.toFixed(1)}</td>
                <td className="px-3 py-2 text-right mono text-zinc-200">{formatCount(row.events)}</td>
                <td className="px-3 py-2 text-right mono text-zinc-200">{formatCount(row.repos)}</td>
                <td className="px-3 py-2 text-right mono text-zinc-200">{formatCount(row.pushes)}</td>
                <td className="px-3 py-2 text-right mono text-zinc-200">{formatCount(row.prs_opened)}</td>
                <td className="rounded-r-xl px-3 py-2 text-right mono text-zinc-200">{formatCount(row.prs_merged)}</td>
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
