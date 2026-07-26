import { NextResponse } from "next/server";
import { hnStoryFeed, hnStoryReplies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const hours = boundedNumber(params.get("hours"), 6, 1, 24);
  const limit = boundedNumber(params.get("limit"), 50, 1, 100);
  const includeReplies = params.get("replies") !== "0";

  try {
    const stories = await hnStoryFeed(hours, limit);
    const replies = includeReplies ? await hnStoryReplies(stories.data.map((story) => story.id)) : [];
    return NextResponse.json({ stories, replies });
  } catch (err) {
    const message = err instanceof Error ? err.message : "story query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
