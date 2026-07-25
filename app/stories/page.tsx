import type { Metadata } from "next";
import { HNStoryStream } from "@/components/HNStoryStream";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Attention Terminal - Hacker News Stories",
  description: "Real-time Hacker News story stream with points velocity and discussion context.",
};

export default async function StoriesPage() {
  return <HNStoryStream />;
}
