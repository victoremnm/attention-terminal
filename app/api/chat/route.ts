import { openai } from "@ai-sdk/openai";
import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { analystSystemPrompt } from "@/lib/agent-prompt";
import { attentionTelemetry, ensureAiSdkTelemetry } from "@/lib/ai-telemetry";
import { attentionToolSchemas } from "@/lib/agent-tool-schemas";

ensureAiSdkTelemetry("next");

// Head-start route for the attention-agent chat. The first message of a new
// chat lands here: step 1 of the turn streams from this warm process while
// the chat.agent run boots in parallel, then hands over for tool execution.
// Subsequent turns go through the Trigger.dev transport directly.
//
// Bundle isolation: only schema-only tools and the plain-string prompt may be
// imported here — no ClickHouse client, no trigger task runtime.
export const POST = chat.headStart({
  agentId: "attention-agent",
  run: async ({ chat: helper }) => {
    const headStartOptions = helper.toStreamTextOptions({
      tools: attentionToolSchemas,
    });
    const headStartTelemetry = headStartOptions as Record<string, unknown> & {
      experimental_telemetry?: {
        metadata?: Record<string, string>;
      };
    };

    return streamText({
      ...headStartOptions,
      experimental_telemetry: {
        ...headStartTelemetry.experimental_telemetry,
        metadata: {
          ...(headStartTelemetry.experimental_telemetry?.metadata ?? {}),
          ...attentionTelemetry("head-start"),
        },
      } as any,
      model: openai("gpt-5.1"),
      system: analystSystemPrompt,
      temperature: 0.2,
    });
  },
});
