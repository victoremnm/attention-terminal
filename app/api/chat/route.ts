import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { analystSystemPrompt } from "@/lib/agent-prompt";
import { attentionTelemetry } from "@/lib/ai-telemetry";
import { attentionToolSchemas } from "@/lib/agent-tool-schemas";
import { resolveAgentModel } from "@/lib/agent-model";

// Head-start route for the attention-agent chat. The first message of a new
// chat lands here: step 1 of the turn streams from this warm process while
// the chat.agent run boots in parallel, then hands over for tool execution.
// Subsequent turns go through the Trigger.dev transport directly.
//
// Bundle isolation: only schema-only tools and the plain-string prompt may be
// imported here — no ClickHouse client, no trigger task runtime. The model
// resolver only imports @ai-sdk/openai + ai, so it's bundle-safe.
//
// Graceful degradation: if TRIGGER_SECRET_KEY is not set (preview deployments,
// local dev without .env), we return a 503 instead of crashing. The production
// deployment has the env var and works normally.

const handler = chat.headStart({
  agentId: "attention-agent",
  run: async ({ chat: helper }) => {
    const headStartOptions = helper.toStreamTextOptions({
      tools: attentionToolSchemas,
    });
    const { telemetry, runtimeContext } = attentionTelemetry("head-start");

    return streamText({
      ...headStartOptions,
      telemetry,
      runtimeContext,
      model: resolveAgentModel(),
      system: analystSystemPrompt,
      temperature: 0.2,
    });
  },
});

export const POST = process.env.TRIGGER_SECRET_KEY
  ? handler
  : async () =>
      new Response(
        JSON.stringify({
          error: "Chat requires Trigger.dev configuration (TRIGGER_SECRET_KEY)",
          hint: "Set TRIGGER_SECRET_KEY in Vercel project → Settings → Environment Variables → Preview environments",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
