"use server";

import { auth } from "@trigger.dev/sdk";

// Read-only token scoped to runs tagged "ingest" (the three ingestion crons),
// so the browser can subscribe to them via Realtime. Mirrors
// mintChatAccessToken in chat-actions.ts.
export async function mintIngestReadToken(): Promise<string | null> {
  try {
    return await auth.createPublicToken({
      scopes: {
        read: { tags: ["ingest"] },
      },
      expirationTime: "1h",
    });
  } catch {
    // No Trigger.dev creds available - the UI falls back to polling.
    return null;
  }
}
