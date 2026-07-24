"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mintChatAccessToken, startChatSession } from "@/lib/chat-actions";
import { guardChatTransport, isClosedReadableStreamError } from "@/lib/chat-stream";
import {
  clampDrawerWidth,
  clampDetachedPosition,
  createFallbackChatId,
  getSafeLocalStorage,
  loadFloatingChatSession,
  saveFloatingChatSession,
} from "@/lib/chat-persistence";
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
  "give me the most popular \"claw\" repos",
  "what agent skills are trending?",
  "what type of visualizations can you make?",
];

const STALL_TIMEOUT_MS = 20_000;

function AttentionChatOverlay({
  chatId,
  initialMessages,
  onMessagesChange,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  onMessagesChange: (messages: UIMessage[]) => void;
}) {
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
    accessToken: useCallback(({ chatId }: { chatId: string }) => mintChatAccessToken(chatId), []),
    startSession: useCallback(
      ({ chatId, clientData }: { chatId: string; clientData?: Record<string, unknown> }) =>
        startChatSession({ chatId, clientData }),
      [],
    ),
    onEvent: useCallback((event: { type: string; error?: { message: string } }) => {
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
          setFault(`send failed: ${event.error?.message}`);
          break;
        case "stream-error":
          disarmWatchdog();
          if (event.error && isClosedReadableStreamError(event.error)) break;
          setFault(`stream error: ${event.error?.message}`);
          break;
      }
    }, []),
  });

  const safeTransport = useMemo(() => guardChatTransport(transport), [transport]);

  const { messages, sendMessage, stop, status, error, regenerate } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: safeTransport,
  });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const faultText = fault ?? (status === "error" ? (error?.message ?? "chat request failed") : null);

  useEffect(() => {
    onMessagesChange(messages);
  }, [messages, onMessagesChange]);

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
        {messages.map((message, index) => {
          const question = message.role === "assistant" ? questionForAssistantMessage(messages, index) : undefined;
          return <Message key={message.id} message={message} question={question} />;
        })}
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
  const fallbackChatIdRef = useRef(createFallbackChatId());
  const initialSnapshot = useState(() => {
    const stored = loadFloatingChatSession(getSafeLocalStorage());
    if (!stored) return null;
    const drawerWidth = clampDrawerWidth(stored.drawerWidth);
    return {
      chatId: stored.chatId || fallbackChatIdRef.current,
      messages: stored.messages,
      detached: stored.detached,
      drawerWidth,
      position: clampDetachedPosition(
        stored.position,
        drawerWidth,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    };
  })[0];
  const chatId = initialSnapshot?.chatId ?? fallbackChatIdRef.current;
  const initialMessages = initialSnapshot?.messages ?? [];
  const [currentMessages, setCurrentMessages] = useState<UIMessage[]>(() => initialMessages);
  const [drawerWidth, setDrawerWidth] = useState(() => initialSnapshot?.drawerWidth ?? 420);
  const [detached, setDetached] = useState(() => initialSnapshot?.detached ?? false);
  const [pos, setPos] = useState(() => initialSnapshot?.position ?? { x: 0, y: 0 });
  const resizingRef = useRef(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startWidthRef = useRef(420);

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
    let startingPos = { ...pos };
    if (!detached) {
      const rect = (e.currentTarget.closest(".floating-chat-drawer") as HTMLElement)?.getBoundingClientRect();
      if (rect) {
        startingPos = { x: rect.left, y: rect.top };
        setPos(startingPos);
        setDetached(true);
      }
    }
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startPosRef.current = startingPos;
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

  const isClosed = ctx.state === "closed";
  const isMinimized = ctx.state === "minimized";
  const drawerStyle: React.CSSProperties = detached
    ? { width: drawerWidth, left: pos.x, top: pos.y, right: "auto", height: "min(600px, 100vh)" }
    : { width: drawerWidth };
  useEffect(() => {
    try {
      saveFloatingChatSession(getSafeLocalStorage(), {
        chatId,
        messages: currentMessages,
        detached,
        drawerWidth,
        position: pos,
      });
    } catch {
      // Best-effort persistence only.
    }
  }, [chatId, currentMessages, detached, drawerWidth, pos]);

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
      {!detached && !isMinimized && !isClosed && <div className="floating-chat-backdrop" aria-hidden="true" />}
      <div
        className={`floating-chat-drawer${detached ? " detached" : ""}${isMinimized ? " minimized-hidden" : ""}`}
        role="dialog"
        aria-label="Chat"
        aria-hidden={isMinimized || isClosed}
        hidden={isClosed}
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
                ⤢
              </button>
            )}
            <button type="button" className="floating-chat-minimize" onClick={() => ctx.minimize()} aria-label="Minimize chat">
              —
            </button>
          </div>
        </header>
        <div className="floating-chat-drawer-body">
          <AttentionChatOverlay
            chatId={chatId}
            initialMessages={initialMessages}
            onMessagesChange={setCurrentMessages}
          />
        </div>
      </div>
    </>
  );
}

// Answer spec v1 / grammar rule: "no trailing prose paragraph." The agent
// often emits a text part AFTER renderAnswer that just restates the caption
// — the design brief forbids it ("if the best answer is a paragraph, you've
// missed the brief"). A message that rendered an answer shows the card alone;
// any text part is hidden. Pure so it's unit-testable without the transport.
export function messageHasRenderAnswer(message: UIMessage): boolean {
  return message.parts.some((p) => p.type === "tool-renderAnswer");
}

// Answer spec v1 anatomy step 1: echo the question as a `›` prompt at the top
// of the answer card. Pull it from the most recent preceding user message.
export function questionForAssistantMessage(messages: UIMessage[], index: number): string | undefined {
  if (index <= 0) return undefined;
  for (let j = index - 1; j >= 0; j--) {
    const prev = messages[j];
    if (prev.role !== "user") continue;
    const textPart = prev.parts.find((p) => p.type === "text");
    if (textPart && textPart.type === "text" && textPart.text.trim()) {
      return textPart.text.trim();
    }
    return undefined;
  }
  return undefined;
}

function Message({ message, question }: { message: UIMessage; question?: string }) {
  const hasRender = messageHasRenderAnswer(message);
  return (
    <article className={`agent-message agent-message-${message.role}`}>
      {message.parts.map((part, index) => {
        if (hasRender && part.type === "text") return null;
        return <MessagePart key={index} part={part} question={question} />;
      })}
    </article>
  );
}

function MessagePart({ part, question }: { part: UIMessage["parts"][number]; question?: string }) {
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
    return <RenderedAnswer payload={parsed.data} showCopy={false} question={question} />;
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
