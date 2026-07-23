"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { attentionTriggerApiClient } from "./trigger-api-client";

// Keep public-token minting on the same default dev environment as session
// creation. Without this, the SDK falls back to VERCEL_GIT_COMMIT_REF on
// preview deployments and Trigger.dev rejects the request when no preview
// branch has been created.
auth.configure(attentionTriggerApiClient);

export const startChatSession = chat.createStartSessionAction("attention-agent", {
  apiClient: attentionTriggerApiClient,
});

export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}
