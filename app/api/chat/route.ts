import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { analystSystemPrompt } from "@/lib/agent-prompt";
import { attentionTelemetry } from "@/lib/ai-telemetry";
import { attentionToolSchemas } from "@/lib/agent-tool-schemas";
import { resolveAgentModel } from "@/lib/agent-model";
import { attentionTriggerApiClient } from "@/lib/trigger-api-client";

// Head-start route for the attention-agent chat. The first message of a new
// chat lands here: step 1 of the turn streams from this warm process while
// the chat.agent run boots in parallel, then hands over for tool execution.
// Subsequent turns go through the Trigger.dev transport directly.
//
// Bundle isolation: only schema-only tools and the plain-string prompt may be
// imported here — no ClickHouse client, no trigger task runtime. The model
// resolver only imports @ai-sdk/openai + ai, so it's bundle-safe.
export const POST = chat.headStart({
  agentId: "attention-agent",
  apiClient: attentionTriggerApiClient,
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
