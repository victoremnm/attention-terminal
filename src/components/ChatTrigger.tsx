"use client";

import { useEffect, useState } from "react";
import { useChatContext } from "@/lib/chat-context";

const ONBOARDED_KEY = "attention-terminal:chat-onboarded";

export function ChatTrigger() {
  const ctx = useChatContext();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) {
        setShowOnboarding(true);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  function handleClick() {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch { /* silent */ }
    setShowOnboarding(false);
    ctx.toggle();
  }

  const isHidden = ctx.state === "open";

  return (
    <>
      {showOnboarding && (
        <div className="chat-onboarding-tooltip">
          Ask the terminal anything — get live visuals over HackerNews + GitHub data
        </div>
      )}
      <button
        type="button"
        className="floating-chat-trigger"
        data-hidden={isHidden}
        onClick={handleClick}
        aria-label={ctx.state === "closed" ? "Open chat" : "Close chat"}
        title="Ask the terminal"
      >
        <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M2 2h16v12H6l-4 4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
    </>
  );
}
