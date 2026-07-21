import { prompts } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { openai } from "@ai-sdk/openai";
import { createProviderRegistry, stepCountIs, streamText } from "ai";
import { z } from "zod";
import { analystPromptTemplate, answerReference } from "../lib/agent-prompt";
import { attentionTools } from "../lib/agent-tools";

const registry = createProviderRegistry({ openai });

const systemPrompt = prompts.define({
  id: "attention-terminal-analyst",
  description: "System prompt for the Attention Terminal ClickHouse analyst agent",
  model: "openai:gpt-5.1",
  config: { temperature: 0.2 },
  variables: z.object({
    answerReference: z.string(),
  }),
  content: analystPromptTemplate,
});

const agentLocal = chat.local<{ lastVisualization?: string }>({ id: "presentation-state" });

export const attentionAgent = chat.agent({
  id: "attention-agent",
  idleTimeoutInSeconds: 300,
  tools: attentionTools,

  onBoot: async () => {
    agentLocal.init({});
  },

  onChatStart: async () => {
    const resolved = await systemPrompt.resolve({ answerReference });
    chat.prompt.set(resolved);
  },

  run: async ({ messages, tools, signal }) => {
    return streamText({
      ...chat.toStreamTextOptions({ registry }),
      model: openai("gpt-5.1"),
      messages,
      tools,
      stopWhen: stepCountIs(15),
      abortSignal: signal,
    });
  },
});
