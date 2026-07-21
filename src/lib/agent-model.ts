// Model resolution for the attention-agent (issue #79 track #85).
//
// Makes the agent model configurable via env var so we can A/B test glm-5.2
// (served via local Ollama) against gpt-5.1 on the same drilldown questions.
// Used by both the head-start route (app/api/chat/route.ts) and the agent
// worker (src/trigger/attention-agent.ts) so they stay in sync.
//
// Env vars:
//   ATTENTION_AGENT_MODEL  — "openai:gpt-5.1" (default) | "glm:glm-5.2" | ...
//   GLM_BASE_URL           — "http://localhost:11434/v1" (Ollama default)
//   GLM_API_KEY            — "ollama" (Ollama default; any non-empty string works)
//
// Telemetry: each run is logged to subagent_experiments (via subagent_runs)
// with model, tokens, latency, cost — so the same drilldown question run
// against both models produces 2 rows with the same spec_hash, different
// model_name.

import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";

export const ATTENTION_AGENT_MODEL = process.env.ATTENTION_AGENT_MODEL ?? "openai:gpt-5.1";

// GLM provider: Ollama exposes an OpenAI-compatible endpoint at /v1.
const glm = createOpenAI({
  baseURL: process.env.GLM_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: process.env.GLM_API_KEY ?? "ollama",
  name: "glm",
});

// Registry with both providers so model strings can switch freely.
export const attentionRegistry = createProviderRegistry({
  openai: createOpenAI({ name: "openai" }),
  glm,
});

// Resolve a "provider:model" string to a LanguageModel instance.
export function resolveAgentModel(modelSpec: string = ATTENTION_AGENT_MODEL): LanguageModel {
  if (!modelSpec.includes(":")) {
    throw new Error(`Invalid model spec: ${modelSpec}. Expected "provider:model" e.g. "openai:gpt-5.1" or "glm:glm-5.2"`);
  }
  // Cast: the registry's languageModel is typed to a union of known model
  // literals, but we resolve from an env var at runtime. The registry
  // accepts any `provider:string` at runtime; the cast bypasses the
  // literal-union inference.
  return attentionRegistry.languageModel(modelSpec as `openai:${string}`) as unknown as LanguageModel;
}

// Spec hash for cross-model comparison: same question + repo = same hash,
// regardless of which model answered. Used as the `spec_hash` column in
// subagent_experiments so we can GROUP BY spec_hash and compare models.
export function drilldownSpecHash(repoName: string, question: string): string {
  // Simple deterministic hash — not cryptographic, just a stable join key.
  const input = `drilldown:${repoName}:${question}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return `drilldown_${(h >>> 0).toString(16)}`;
}