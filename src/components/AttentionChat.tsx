"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { UIMessage } from "ai";
import { useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/lib/chat-actions";
import { RenderPayloadSchema } from "@/lib/render-payload";
import type { attentionAgent } from "@/trigger/attention-agent";
import { RenderedAnswer } from "./RenderedAnswer";

const SUGGESTIONS = [
  "what's new?",
  "is htmx hype or real?",
  "what data do I have?",
];

export function AttentionChat() {
  const transport = useTriggerChatTransport<typeof attentionAgent>({
    task: "attention-agent",
    baseURL: process.env.NEXT_PUBLIC_TRIGGER_API_URL,
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, stop, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <section className="agent-chat" aria-label="Attention Terminal chat agent">
      <header className="agent-chat-head">
        <div>
          <p className="mono">CHAT.AGENT</p>
          <h2>Ask the terminal</h2>
        </div>
        <span className="mono">{busy ? "streaming" : "ready"}</span>
      </header>

      <div className="agent-messages">
        {messages.length === 0 && (
          <div className="agent-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="chip" onClick={() => submit(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => <Message key={message.id} message={message} />)}
      </div>

      <form
        className="agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="ask about tech attention..."
          className="mono"
        />
        {busy ? (
          <button type="button" className="chip" onClick={() => stop()}>stop</button>
        ) : (
          <button type="submit" className="chip" disabled={!input.trim()}>send</button>
        )}
      </form>
    </section>
  );
}

function Message({ message }: { message: UIMessage }) {
  return (
    <article className={`agent-message agent-message-${message.role}`}>
      {message.parts.map((part, index) => <MessagePart key={index} part={part} />)}
    </article>
  );
}

function MessagePart({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <p>{part.text}</p>;
  }

  if (part.type === "tool-renderAnswer") {
    const input = part.input as { payload?: unknown } | undefined;
    const output = part.output as { ok?: boolean; errors?: string[] } | undefined;
    const parsed = RenderPayloadSchema.safeParse(input?.payload);

    if (output?.ok === false) {
      return <div className="agent-tool mono">refining payload...</div>;
    }
    if (!parsed.success) {
      return <div className="agent-tool mono">building answer...</div>;
    }
    return <RenderedAnswer payload={parsed.data} />;
  }

  if (part.type === "tool-listTables") {
    return <ToolStatus label="listing tables" done={part.state === "output-available"} />;
  }

  if (part.type === "tool-describeTable") {
    const input = part.input as { table?: string } | undefined;
    return <ToolStatus label={`describing ${input?.table ?? "table"}`} done={part.state === "output-available"} />;
  }

  if (part.type === "tool-runReadOnlyQuery") {
    const input = part.input as { query?: string } | undefined;
    return (
      <details className="agent-query">
        <summary className="mono">{part.state === "output-available" ? "query complete" : "running query"}</summary>
        {input?.query && <pre className="mono">{input.query}</pre>}
      </details>
    );
  }

  if (part.type === "tool-getDailyDigest") {
    return <ToolStatus label="computing daily skinny" done={part.state === "output-available"} />;
  }

  return null;
}

function ToolStatus({ label, done }: { label: string; done: boolean }) {
  return <div className="agent-tool mono">{done ? "done" : "..."} · {label}</div>;
}
