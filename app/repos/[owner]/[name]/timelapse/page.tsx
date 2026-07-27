import { notFound } from "next/navigation";
import { timelapseWindows, timelapseSummary, timelapseWindowEvents } from "@/lib/queries";
import { TimelapseSurface } from "@/components/TimelapseSurface";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ owner: string; name: string }>;
}

export default async function TimelapsePage({ params }: PageProps) {
  const { owner, name } = await params;
  const repoName = `${owner}/${name}`;

  const [windowsResult, summaryResult] = await Promise.all([
    timelapseWindows(repoName),
    timelapseSummary(repoName),
  ]);

  const windows = windowsResult.data;
  const summary = summaryResult.data;

  // Fetch raw events for expanded windows (latest 6 hours only to keep the query light)
  let events: Awaited<ReturnType<typeof timelapseWindowEvents>>["data"] = [];
  if (windows.length > 0) {
    const latestWindows = windows.slice(0, 6);
    const eventResults = await Promise.all(
      latestWindows.map((w) => timelapseWindowEvents(repoName, w.window_start, w.window_end))
    );
    for (const r of eventResults) events = events.concat(r.data);
  }

  return <TimelapseSurface windows={windows} summary={summary} events={events} repoName={repoName} />;
}
