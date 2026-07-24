import { prompts } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { attentionTelemetry, ensureAiSdkTelemetry } from "../lib/ai-telemetry";
import { analystPromptTemplate, answerReference } from "../lib/agent-prompt";
import { ATTENTION_AGENT_MODEL, attentionRegistry, resolveAgentModel } from "../lib/agent-model";
import { attentionTools, resetCatalogState } from "../lib/agent-tools";
import { catalogPromptSection } from "../lib/catalog";
import { subjectSynonymsPromptSection } from "../lib/subject-synonyms";
import { logAgentRun } from "../lib/agent-telemetry";
import { shouldForceRenderAnswer } from "../lib/agent-render-enforcement";

ensureAiSdkTelemetry("trigger");

const systemPrompt = prompts.define({
  id: "attention-terminal-analyst",
  description: "System prompt for the Attention Terminal ClickHouse analyst agent",
  model: ATTENTION_AGENT_MODEL,
  config: { temperature: 0.2 },
  variables: z.object({
    answerReference: z.string(),
    catalogReference: z.string(),
    subjectSynonyms: z.string(),
    conversationMemory: z.string(),
  }),
  content: analystPromptTemplate,
});

// Run-scoped conversation memory (issue #141): tracks what renderAnswer
// payloads were already shown this session so the next turn's system prompt
// can acknowledge continuity and avoid repeating the same subject+type back
// to back. This is in-memory only — it resets on a fresh worker (idle
// timeout / continuation run); durable cross-session persistence and
// reload/restore are issue #145's scope, not duplicated here.
type PresentationState = {
  lastVisualization?: string;
  recentAnswers: Array<{ turn: number; type: string; subject: string }>;
};

const agentLocal = chat.local<PresentationState>({ id: "presentation-state" });

function summarizeMemory(state: PresentationState): string {
  if (!state.recentAnswers.length) return "";
  const lines = state.recentAnswers
    .slice(-3)
    .map((answer) => `- turn ${answer.turn}: ${answer.type}${answer.subject ? ` — ${answer.subject}` : ""}`);
  return `Prior answers this conversation (most recent last):\n${lines.join("\n")}`;
}

// Best-effort extraction of the payload a completed turn rendered, so the
// next turn can reference it. Duck-typed against the ai-sdk UIMessage shape
// (message.parts[].type === "tool-renderAnswer") rather than importing the
// full UIMessage generic here — mirrors the casts already used in
// AttentionChat.tsx's MessagePart renderer.
function extractRenderedAnswer(message: unknown): { type: string; subject: string } | null {
  if (!message || typeof message !== "object" || !("parts" in message)) return null;
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: string; state?: string; input?: unknown; output?: unknown };
    if (candidate.type !== "tool-renderAnswer" || candidate.state !== "output-available") continue;
    const output = candidate.output as { ok?: boolean } | undefined;
    if (output?.ok === false) continue;
    const input = candidate.input as { payload?: Record<string, unknown> } | undefined;
    const payload = input?.payload;
    if (!payload || typeof payload.type !== "string") continue;
    const subject =
      (typeof payload.subject === "string" && payload.subject) ||
      (typeof payload.repoName === "string" && payload.repoName) ||
      (typeof payload.filter === "string" && payload.filter) ||
      (typeof payload.summary === "string" && payload.summary.slice(0, 60)) ||
      "";
    return { type: payload.type, subject };
  }
  return null;
}

export const attentionAgent = chat.agent({
  id: "attention-agent",
  idleTimeoutInSeconds: 300,
  tools: attentionTools,

  onBoot: async () => {
    resetCatalogState();
    agentLocal.init({ recentAnswers: [] });
  },

  onChatStart: async () => {
    const catalogReference = await catalogPromptSection();
    const resolved = await systemPrompt.resolve({
      answerReference,
      catalogReference,
      subjectSynonyms: subjectSynonymsPromptSection(),
      conversationMemory: "",
    });
    chat.prompt.set(resolved);
  },

  // Re-resolve the system prompt on every follow-up turn so the model sees
  // what it already rendered this session. onChatStart only fires on turn 0
  // (it also runs onTurnStart right after), so turns >= 1 need their own
  // refresh with the accumulated memory.
  onTurnStart: async ({ turn }) => {
    if (turn === 0) return;
    const catalogReference = await catalogPromptSection();
    const resolved = await systemPrompt.resolve({
      answerReference,
      catalogReference,
      subjectSynonyms: subjectSynonymsPromptSection(),
      conversationMemory: summarizeMemory(agentLocal.get()),
    });
    chat.prompt.set(resolved);
  },

  // Record what got rendered this turn so the next turn's memory summary can
  // reference it.
  onTurnComplete: async ({ turn, responseMessage }) => {
    const answer = extractRenderedAnswer(responseMessage);
    if (!answer) return;
    const state = agentLocal.get();
    agentLocal.recentAnswers = [...state.recentAnswers, { turn, ...answer }].slice(-5);
    agentLocal.lastVisualization = answer.type;
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
      prepareStep: ({ steps, stepNumber }) => {
        const toolNamesCalledSoFar = steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName)
        );
        if (shouldForceRenderAnswer(toolNamesCalledSoFar, stepNumber)) {
          return { toolChoice: { type: "tool", toolName: "renderAnswer" } };
        }
        return {};
      },
    });

    // Log the run to subagent_experiments (via subagent_runs) for cross-model
    // comparison (issue #79 track #85). usage resolves when the stream finishes.
    // Extract the last user message text as the question for spec_hash grouping
    // so the same question across models shares a task_hash.
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const userQuestion = typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : Array.isArray(lastUserMessage?.content)
        ? lastUserMessage.content.map((p) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join(" ")
        : "";
    Promise.resolve(result.usage).then((usage) => {
      const latencyMs = Date.now() - runStart;
      Promise.resolve(logAgentRun({
        agentType: "attention-agent",
        model: ATTENTION_AGENT_MODEL,
        latencyMs,
        inputTokens: usage.inputTokens ?? 0,
        inputTokensProvenance: usage.inputTokens === undefined ? "estimated" : "measured",
        outputTokens: usage.outputTokens ?? 0,
        outputTokensProvenance: usage.outputTokens === undefined ? "estimated" : "measured",
        // Vercel AI SDK usage doesn't carry cost; the subagent_experiments view
        // tolerates 0 cost (the OTel bridge or a pricing lookup can fill it later).
        costUsd: 0,
        question: userQuestion,
      })).catch((err: unknown) => console.error("[attention-agent] telemetry log failed", { err }));
    }).catch(() => { /* never block the agent on telemetry */ });

    return result;
  },
});
