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

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Event Stream",
  description: "Real-time GitHub event firehose with payload drilldown and volume analytics.",
};

export default async function EventsPage() {
  const [timeline, volume, statsResult, signalResult, eventMixResult, hourlyResult] =
    await Promise.all([
      eventTimelineFeed(50),
      eventVolumeFeed(),
      firehoseStats(),
      firehoseRepoSignal(24, 20),
      firehoseEventMix(24, 100),
      eventTypeHourlyAggregation(24),
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
      signalData={signalResult.data}
      eventMixData={eventMixResult.data}
      hourlyData={hourlyResult.data}
    />
  );
}
