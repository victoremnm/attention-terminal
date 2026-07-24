import { NextResponse } from "next/server";
import { threadInsights } from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const subject = new URL(request.url).searchParams.get("subject")?.trim() ?? "";
  if (!subject) return NextResponse.json({ error: "subject is required" }, { status: 400 });

  try {
    const insights = await threadInsights(subject);
    if (!insights) return NextResponse.json({ error: "no HN thread evidence" }, { status: 404 });
    return NextResponse.json(insights);
  } catch (err) {
    const message = err instanceof Error ? err.message : "thread query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
