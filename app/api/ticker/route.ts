import { NextResponse } from "next/server";
import { tickerLanes } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lanes = await tickerLanes();
    return NextResponse.json(lanes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
