import { NextRequest, NextResponse } from "next/server";
import { hfModelDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params;
  const decoded = decodeURIComponent(modelId);

  try {
    const result = await hfModelDetail(decoded);
    if (!result.data) {
      return NextResponse.json({ error: `Model not found: ${decoded}` }, { status: 404 });
    }
    return NextResponse.json({
      data: result.data,
      provenance: { sql: result.sql, elapsedMs: result.elapsedMs, rowsRead: result.rowsRead },
    });
  } catch {
    return NextResponse.json({ error: "model detail query failed" }, { status: 500 });
  }
}
