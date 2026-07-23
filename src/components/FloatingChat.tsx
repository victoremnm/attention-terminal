"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/lib/chat-actions";
import { RenderPayloadSchema } from "@/lib/render-payload";
import type { attentionAgent } from "@/trigger/attention-agent";
import { MarkdownText } from "./MarkdownText";
import { RenderedAnswer } from "./RenderedAnswer";
import { useChatContext } from "@/lib/chat-context";

const SUGGESTIONS = [
  "what's new?",
  "is htmx hype or real?",
  "what data do I have?",
  "show me the daily skinny",
  "what's trending in the last 24h?",
  "compare htmx vs alpine",
];

const STALL_TIMEOUT_MS = 20_000;

function AttentionChatOverlay() {
  const [fault, setFault] = useState<string | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctx = useChatContext();

  function disarmWatchdog() {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  }

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
          setFault(`stream error: ${event.error.message}`);
          break;
      }
    },
  });

  const { messages, sendMessage, stop, status, error, regenerate } = useChat({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const faultText = fault ?? (status === "error" ? (error?.message ?? "chat request failed") : null);

  ctx.sendMessageRef.current = (text: string) => sendMessage({ text });

  useEffect(() => {
    if (ctx.pendingInput.trim()) {
      setInput(ctx.pendingInput);
      ctx.clearPendingInput();
    }
  }, [ctx.pendingInput]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setFault(null);
    sendMessage({ text: trimmed });
    setInput("");
  }

  async function retry() {
    setFault(null);
    await stop();
    await regenerate();
  }

  return (
    <section className="agent-chat" aria-label="Attention Terminal chat agent">
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
          <button type="button" className="chip" onClick={() => void retry()}>retry</button>
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

export function FloatingChat() {
  const ctx = useChatContext();
  const [animateIn, setAnimateIn] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(420);
  const [detached, setDetached] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const resizingRef = useRef(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startWidthRef = useRef(420);

  useEffect(() => {
    if (ctx.state === "open") {
      requestAnimationFrame(() => setAnimateIn(true));
    } else {
      setAnimateIn(false);
      setDetached(false);
    }
  }, [ctx.state]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = drawerWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", endResize);
  }

  function onResizeMove(e: PointerEvent) {
    if (!resizingRef.current) return;
    const delta = startXRef.current - e.clientX;
    const newWidth = Math.min(720, Math.max(320, startWidthRef.current + delta));
    setDrawerWidth(newWidth);
  }

  function endResize() {
    resizingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
  }

  function startDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!detached) {
      const rect = (e.currentTarget.closest(".floating-chat-drawer") as HTMLElement)?.getBoundingClientRect();
      if (rect) {
        setPos({ x: rect.left, y: rect.top });
        setDetached(true);
        startPosRef.current = { x: rect.left, y: rect.top };
      }
    }
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startPosRef.current = { ...pos };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
  }

  function onDragMove(e: PointerEvent) {
    if (!draggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    const newX = Math.max(0, Math.min(window.innerWidth - drawerWidth, startPosRef.current.x + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 48, startPosRef.current.y + dy));
    setPos({ x: newX, y: newY });
  }

  function endDrag() {
    draggingRef.current = false;
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endDrag);
    };
  }, []);

  if (ctx.state === "closed") return null;

  const isMinimized = ctx.state === "minimized";
  const drawerStyle: React.CSSProperties = detached
    ? { width: drawerWidth, left: pos.x, top: pos.y, right: "auto", height: "min(600px, 100vh)" }
    : { width: drawerWidth };

  return (
    <>
      {isMinimized && (
        <div className="floating-chat-minimized" role="button" tabIndex={0}
          onClick={() => ctx.setState("open")}
          onKeyDown={(e) => e.key === "Enter" && ctx.setState("open")}
          aria-label="Open chat">
          <span className="mono">CHAT</span>
          <button
            className="floating-chat-close"
            onClick={(e) => { e.stopPropagation(); ctx.close(); }}
            aria-label="Close chat"
            type="button"
          >
            ×
          </button>
        </div>
      )}
      {!detached && !isMinimized && <div className="floating-chat-backdrop" onClick={() => ctx.close()} />}
      <div
        className={`floating-chat-drawer${detached ? " detached" : ""}${isMinimized ? " minimized-hidden" : ""}`}
        role="dialog"
        aria-label="Chat"
        aria-hidden={isMinimized}
        style={drawerStyle}
      >
        <div className="floating-chat-resize-handle" onPointerDown={startResize} aria-hidden="true" />
        <header
          className="floating-chat-drawer-head"
          onPointerDown={startDrag}
          style={{ cursor: "grab" }}
        >
          <div className="floating-chat-drawer-head-left">
            <span className="status-dot" data-status="ready" />
            <p className="mono kicker">CHAT.AGENT</p>
          </div>
          <div className="floating-chat-drawer-actions">
            {detached && (
              <button type="button" className="chip" onClick={() => setDetached(false)} aria-label="Dock to side">
                ⬈
              </button>
            )}
            <button type="button" className="chip" onClick={() => ctx.minimize()} aria-label="Minimize chat">
              _
            </button>
            <button type="button" className="floating-chat-close" onClick={() => ctx.close()} aria-label="Close chat">
              ×
            </button>
          </div>
        </header>
        <div className="floating-chat-drawer-body">
          <AttentionChatOverlay />
        </div>
      </div>
    </>
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
    return <RenderedAnswer payload={parsed.data} showCopy={false} />;
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
