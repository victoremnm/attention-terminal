import { prompts } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { openai } from "@ai-sdk/openai";
import { createProviderRegistry, stepCountIs, streamText } from "ai";
import { z } from "zod";
import { attentionTelemetry, ensureAiSdkTelemetry } from "../lib/ai-telemetry";
import { analystPromptTemplate, answerReference } from "../lib/agent-prompt";
import { attentionTools, resetCatalogState } from "../lib/agent-tools";
import { catalogPromptSection } from "../lib/catalog";

ensureAiSdkTelemetry("trigger");

const registry = createProviderRegistry({ openai });

const systemPrompt = prompts.define({
  id: "attention-terminal-analyst",
  description: "System prompt for the Attention Terminal ClickHouse analyst agent",
  model: "openai:gpt-5.1",
  config: { temperature: 0.2 },
  variables: z.object({
    answerReference: z.string(),
    catalogReference: z.string(),
  }),
  content: analystPromptTemplate,
});

const agentLocal = chat.local<{ lastVisualization?: string }>({ id: "presentation-state" });

export const attentionAgent = chat.agent({
  id: "attention-agent",
  idleTimeoutInSeconds: 300,
  tools: attentionTools,

  onBoot: async () => {
    resetCatalogState();
    agentLocal.init({});
  },

  onChatStart: async () => {
    const catalogReference = await catalogPromptSection();
    const resolved = await systemPrompt.resolve({
      answerReference,
      catalogReference,
    });
    chat.prompt.set(resolved);
  },

  run: async ({ messages, tools, signal }) => {
    const { telemetry, runtimeContext } = attentionTelemetry("worker");

    return streamText({
      ...chat.toStreamTextOptions({
        registry,
      }),
      telemetry,
      runtimeContext,
      model: openai("gpt-5.1"),
      messages,
      tools,
      stopWhen: stepCountIs(15),
      abortSignal: signal,
    });
  },
});
