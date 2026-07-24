import { NextResponse } from "next/server";
import { fetchQueryPerformanceData } from "@/lib/query-performance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchQueryPerformanceData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load query performance data:", error);
    return NextResponse.json({ error: "Failed to load query performance data." }, { status: 500 });
  }
}
