import { NextResponse } from "next/server";
import { fetchTelemetryData } from "@/lib/telemetry-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchTelemetryData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch telemetry data:", error);
    return NextResponse.json(
      { error: "Failed to query ClickHouse telemetry data" },
      { status: 500 }
    );
  }
}
