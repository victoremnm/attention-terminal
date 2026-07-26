import type { Metadata } from "next";
import { EventsSurface } from "@/components/EventsSurface";
import {
  eventTimelineFeed,
  eventVolumeFeed,
  firehoseStats,
  firehoseRepoSignal,
  firehoseEventMix,
  eventTypeHourlyAggregation,
} from "@/lib/queries";
import { mintIngestReadToken } from "@/lib/realtime-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Event Stream",
  description: "Real-time GitHub event firehose with payload drilldown and volume analytics.",
};

export default async function EventsPage() {
  const [timeline, volume, statsResult, signalResult, eventMixResult, hourlyResult, ingestToken] =
    await Promise.all([
      eventTimelineFeed(100),
      eventVolumeFeed(),
      firehoseStats(),
      firehoseRepoSignal(24, 20),
      firehoseEventMix(24, 100),
      eventTypeHourlyAggregation(24),
      mintIngestReadToken(),
    ]);

  const stats = statsResult.data[0] ?? {
    total_events: "0",
    total_repos: "0",
    total_actors: "0",
    latest_event: "",
  };

  return (
    <EventsSurface
      timeline={timeline.data}
      volume={volume.data}
      stats={stats}
      ingestToken={ingestToken ?? undefined}
      signalData={signalResult.data}
      eventMixData={eventMixResult.data}
      hourlyData={hourlyResult.data}
    />
  );
}
