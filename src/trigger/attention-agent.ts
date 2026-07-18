import { prompts } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createProviderRegistry, stepCountIs, streamText } from "ai";
import { z } from "zod";
import { attentionTools } from "../lib/agent-tools";

const registry = createProviderRegistry({ anthropic });

const answerReference = `Answer grammar:
- Always answer with exactly one primary renderAnswer payload when the answer contains data.
- Fixed verdict vocabulary: ACCELERATING, PEAKING, COOLING, DORMANT, BREAKOUT, DIVERGENT.
- Do not emit HTML, JSX, markdown tables, or long prose walls.
- Digest payload: { type: "digest", generatedAt, noiseFloor, clusters }.
- Ticker payload: { type: "ticker", filter, generatedAt, items }.
- Divergence payload: { type: "divergence", subject, verdict, days, talk, code, caption }.
- Candles payload: { type: "candles", subject, verdict, days, values, caption }.
- Matrix payload: { type: "matrix", generatedAt, topics }.
- Captions and skinny copy must stay within the schema limits.
- Empty prompt, daily-open, "what's new", and broad daily triage should call getDailyDigest and then renderAnswer with that digest payload.
- For custom SQL, list tables first if the schema is uncertain, describe the table before querying, run bounded read-only SQL, then renderAnswer.`;

const systemPrompt = prompts.define({
  id: "attention-terminal-analyst",
  description: "System prompt for the Attention Terminal ClickHouse analyst agent",
  model: "anthropic:claude-sonnet-4-5",
  config: { temperature: 0.2 },
  variables: z.object({
    answerReference: z.string(),
  }),
  content: `You are Attention Terminal's analyst agent. You triage technology attention using ClickHouse data from Hacker News, GitHub, and related ingestion tables.

Your job is to produce visual, bounded answers that match the product's answer grammar. The response itself is the product.

Data rules:
- Use ClickHouse SQL, not Postgres or MySQL syntax.
- Prefer aggregations over raw rows.
- Keep queries bounded and readable.
- Never attempt writes, DDL, mutations, settings changes, or credential inspection.
- If SQL fails, read the error, fix the query, and retry once or twice.

Product rules:
- If the user asks broadly what's new, asks nothing, or opens the daily view, use getDailyDigest and render it.
- Use talk-vs-code divergence whenever the user asks whether something is hype or real.
- Use ticker for "now", "new", "latest", "live", star breakouts, or newly created repos.
- Use concise copy only inside the render payload. After renderAnswer, add at most one sentence if needed.

{{answerReference}}`,
});

export const attentionAgent = chat.agent({
  id: "attention-agent",
  idleTimeoutInSeconds: 300,
  tools: attentionTools,

  onChatStart: async () => {
    const resolved = await systemPrompt.resolve({ answerReference });
    chat.prompt.set(resolved);
  },

  run: async ({ messages, tools, signal }) => {
    return streamText({
      model: anthropic("claude-sonnet-4-5"),
      ...chat.toStreamTextOptions({ registry }),
      messages,
      tools,
      stopWhen: stepCountIs(15),
      abortSignal: signal,
    });
  },
});
