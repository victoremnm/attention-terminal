"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/lib/chat-actions";
import { guardChatTransport, isClosedReadableStreamError } from "@/lib/chat-stream";
import { hasUserMessage } from "@/lib/chat-validation";
import { RenderPayloadSchema } from "@/lib/render-payload";
import type { attentionAgent } from "@/trigger/attention-agent";
import { MarkdownText } from "./MarkdownText";
import { RenderedAnswer } from "./RenderedAnswer";

const SUGGESTIONS = [
  "what's new?",
  "is htmx hype or real?",
  "give me the most popular \"claw\" repos",
  "what agent skills are trending?",
  "what type of visualizations can you make?",
];

const STALL_TIMEOUT_MS = 20_000;

export function AttentionChat() {
  const [fault, setFault] = useState<string | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  function disarmWatchdog() {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  }

  // A send that never produces a first chunk is the failure mode the direct
  // transport can't report on its own — surface it instead of spinning.
  function armWatchdog() {
    disarmWatchdog();
    watchdog.current = setTimeout(() => {
      setFault("no response from the agent — the run may not be executing");
    }, STALL_TIMEOUT_MS);
  }

  useEffect(() => disarmWatchdog, []);

  const transport = useTriggerChatTransport<typeof attentionAgent>({
    task: "attention-agent",
    baseURL: process.env.NEXT_PUBLIC_TRIGGER_API_URL,
    headStart: "/api/chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
    onEvent: (event) => {
      switch (event.type) {
        case "message-sent":
          armWatchdog();
          break;
        case "first-chunk":
        case "turn-completed":
          disarmWatchdog();
          setFault(null);
          break;
        case "message-send-failed":
          disarmWatchdog();
          setFault(`send failed: ${event.error.message}`);
          break;
        case "stream-error":
          disarmWatchdog();
          if (isClosedReadableStreamError(event.error)) break;
          setFault(`stream error: ${event.error.message}`);
          break;
      }
    },
  });

  const safeTransport = useMemo(() => guardChatTransport(transport), [transport]);

  const { messages, sendMessage, stop, status, error, regenerate } = useChat({ transport: safeTransport });
  const [input, setInput] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  const busy = status === "submitted" || status === "streaming";
  const faultText = fault ?? (status === "error" ? (error?.message ?? "chat request failed") : null);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setFault(null);
    sendMessage({ text: trimmed });
    setInput("");
  }

  async function retry() {
    if (retryingRef.current || busy) return;
    if (!hasUserMessage(messages)) {
      setFault("there is no user message to retry");
      return;
    }

    retryingRef.current = true;
    setRetrying(true);
    setFault(null);
    try {
      await regenerate();
    } catch (retryError) {
      setFault(`retry failed: ${retryError instanceof Error ? retryError.message : "unknown error"}`);
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }

  return (
    <section className="agent-chat" aria-label="Attention Terminal chat agent">
      <header className="agent-chat-head">
        <div>
          <p className="mono">CHAT.AGENT</p>
          <h2>Ask the terminal</h2>
        </div>
        <span className="mono">{faultText ? "fault" : busy ? "streaming" : "ready"}</span>
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

      {faultText && (
        <div className="agent-fault mono" role="alert">
          <span>! {faultText}</span>
          <button type="button" className="chip" disabled={retrying || busy} onClick={() => void retry()}>retry</button>
        </div>
      )}

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
    return <MarkdownText text={part.text} />;
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

  if (part.type === "tool-getRepoDrilldown") {
    const input = part.input as { repoName?: string } | undefined;
    return <ToolStatus label={`drilling into ${input?.repoName ?? "repo"}`} done={part.state === "output-available"} />;
  }

  return null;
}

function ToolStatus({ label, done }: { label: string; done: boolean }) {
  return <div className="agent-tool mono">{done ? "done" : "..."} · {label}</div>;
}
