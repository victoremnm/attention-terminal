import type { Metadata } from "next";
import { EventsSurface } from "@/components/EventsSurface";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Event Stream",
  description: "Real-time GitHub event firehose with payload drilldown and volume analytics.",
};

export default async function EventsPage() {
  return <EventsSurface />;
}
