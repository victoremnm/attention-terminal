import { afterEach, describe, expect, it, vi } from "vitest";

const originalBranch = process.env.VERCEL_GIT_COMMIT_REF;
const originalPreviewBranch = process.env.TRIGGER_PREVIEW_BRANCH;
const originalSecretKey = process.env.TRIGGER_SECRET_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  if (originalBranch === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
  else process.env.VERCEL_GIT_COMMIT_REF = originalBranch;
  if (originalPreviewBranch === undefined) delete process.env.TRIGGER_PREVIEW_BRANCH;
  else process.env.TRIGGER_PREVIEW_BRANCH = originalPreviewBranch;
  if (originalSecretKey === undefined) delete process.env.TRIGGER_SECRET_KEY;
  else process.env.TRIGGER_SECRET_KEY = originalSecretKey;
});

describe("chat handover Trigger API integration", () => {
  it("does not route a Vercel preview session to a missing Trigger branch env", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "fix/146-chat-markdown";
    delete process.env.TRIGGER_PREVIEW_BRANCH;
    process.env.TRIGGER_SECRET_KEY = "tr_dev_integration_test";

    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      requests.push({ url, headers });

        expect(url).toContain("/api/v1/sessions");
        return Response.json({
          id: "session_integration",
          externalId: "chat_integration",
          type: "chat.agent",
          taskIdentifier: "attention-agent",
          triggerConfig: { basePayload: {} },
          currentRunId: "run_integration",
          tags: ["chat:chat_integration"],
          metadata: null,
          closedAt: null,
          closedReason: null,
          expiresAt: null,
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
          publicAccessToken: "token_integration",
          runId: "run_integration",
          isCached: false,
        });
    }));

    const { startChatSession } = await import("./chat-actions");
    const result = await startChatSession({ chatId: "chat_integration" });

    expect(result).toMatchObject({
      publicAccessToken: "token_integration",
      sessionId: "session_integration",
      runId: "run_integration",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get("x-trigger-branch")).toBeNull();
  });
});
