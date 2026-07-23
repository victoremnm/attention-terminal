"use client";

import { useChatContext } from "@/lib/chat-context";

export function ChatTrigger() {
  const ctx = useChatContext();

  return (
    <button
      type="button"
      className="floating-chat-trigger"
      onClick={() => ctx.toggle()}
      aria-label={ctx.state === "closed" ? "Open chat" : "Close chat"}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M2 2h16v12H6l-4 4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </button>
  );
}
