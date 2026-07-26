import { NextRequest, NextResponse } from "next/server";
import { hfTopModels } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sort = (searchParams.get("sort") || "downloads") as "downloads" | "likes" | "created_at";
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  try {
    const result = await hfTopModels(sort, limit);
    return NextResponse.json({
      data: result.data,
      fetchedAt: new Date().toISOString(),
      provenance: {
        sql: result.sql,
        elapsedMs: result.elapsedMs,
        rowsRead: result.rowsRead,
      },
    });
  } catch {
    return NextResponse.json({ error: "models query failed" }, { status: 500 });
  }
}
