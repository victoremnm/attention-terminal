"use client";

import { useEffect, useState } from "react";
import type { ActorRepoRow, TopActorReposResult } from "@/lib/queries";

export function TopActorRepos({
  data,
  window,
  fetchedAt,
}: {
  data: ActorRepoRow[];
  window: string;
  fetchedAt?: string;
}) {
  // formatFreshness() calls Date.now(), so it must not run during SSR/hydration --
  // the elapsed-seconds text computed on the server almost never matches what the
  // client recomputes a moment later, which throws React hydration error #418.
  // Deferring it to a post-mount effect makes the freshness text client-only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="actor-repos-container">
      <h2 className="section-title">Top Contributors & Their Repos</h2>
      <p className="section-meta">
        Most active non-bot contributors over the last {window}, ranked by engagement
        {mounted && fetchedAt && <span className="freshness"> · {formatFreshness(fetchedAt)}</span>}
      </p>

      <div className="actors-leaderboard">
        {data.map((actor, rank) => (
          <div key={actor.actor} className="actor-card">
            <div className="actor-header">
              <span className="actor-rank">{rank + 1}</span>
              <span className="actor-name">{actor.actor}</span>
              <span className="actor-stats mono">
                {actor.totalCommits} commits · {actor.totalPrs} PRs · {actor.totalRepos} repos
              </span>
            </div>

            <div className="actor-repos">
              {actor.repos.map((repo) => (
                <a
                  key={repo.repoName}
                  href={`https://github.com/${repo.repoName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="repo-chip"
                >
                  <span className="repo-name">{repo.repoName}</span>
                  <span className="repo-meta mono">
                    {repo.commits} · {repo.prsOpened + repo.prsMerged} PRs
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatFreshness(fetchedAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 1000));
  if (seconds < 90) return `data ${seconds}s old`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `data ${minutes}m old`;
  const hours = Math.round(minutes / 60);
  return `data ${hours}h old`;
}
