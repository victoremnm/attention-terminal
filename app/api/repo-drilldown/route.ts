import { NextRequest, NextResponse } from "next/server";
import { repoDrilldown } from "@/lib/queries";

export const dynamic = "force-dynamic";

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function GET(request: NextRequest) {
  const repoName = request.nextUrl.searchParams.get("repo")?.trim() ?? "";
  if (!REPO_NAME.test(repoName)) {
    return NextResponse.json({ error: "repo must be an owner/repo name" }, { status: 400 });
  }

  try {
    return NextResponse.json(await repoDrilldown(repoName));
  } catch (err) {
    const message = err instanceof Error ? err.message : "query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
