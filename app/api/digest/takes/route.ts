import { NextResponse } from "next/server";
import { debateTakes } from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subject = searchParams.get("subject") ?? "";
  try {
    const takes = await debateTakes(subject);
    if (!takes) return NextResponse.json({ error: "unknown subject" }, { status: 404 });
    return NextResponse.json(takes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "takes query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
