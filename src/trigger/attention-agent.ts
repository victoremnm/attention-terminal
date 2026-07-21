import { prompts } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { attentionTelemetry, ensureAiSdkTelemetry } from "../lib/ai-telemetry";
import { analystPromptTemplate, answerReference } from "../lib/agent-prompt";
import { ATTENTION_AGENT_MODEL, attentionRegistry, resolveAgentModel } from "../lib/agent-model";
import { attentionTools, resetCatalogState } from "../lib/agent-tools";
import { catalogPromptSection } from "../lib/catalog";
import { logAgentRun } from "../lib/agent-telemetry";

ensureAiSdkTelemetry("trigger");

const systemPrompt = prompts.define({
  id: "attention-terminal-analyst",
  description: "System prompt for the Attention Terminal ClickHouse analyst agent",
  model: ATTENTION_AGENT_MODEL,
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
    const model = resolveAgentModel();
    const runStart = Date.now();

    const result = streamText({
      ...chat.toStreamTextOptions({
        registry: attentionRegistry,
      }),
      telemetry,
      runtimeContext,
      model,
      messages,
      tools,
      stopWhen: stepCountIs(15),
      abortSignal: signal,
    });

    // Log the run to subagent_experiments (via subagent_runs) for cross-model
    // comparison (issue #79 track #85). usage resolves when the stream finishes.
    Promise.resolve(result.usage).then((usage) => {
      const latencyMs = Date.now() - runStart;
      Promise.resolve(logAgentRun({
        agentType: "attention-agent",
        model: ATTENTION_AGENT_MODEL,
        latencyMs,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        // Vercel AI SDK usage doesn't carry cost; the subagent_experiments view
        // tolerates 0 cost (the OTel bridge or a pricing lookup can fill it later).
        costUsd: 0,
      })).catch((err: unknown) => console.error("[attention-agent] telemetry log failed", { err }));
    }).catch(() => { /* never block the agent on telemetry */ });

    return result;
  },
});
