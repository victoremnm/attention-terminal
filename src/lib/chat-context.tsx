"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ChatState = "closed" | "minimized" | "open";

type ChatContextValue = {
  state: ChatState;
  setState: (state: ChatState) => void;
  toggle: () => void;
  open: () => void;
  minimize: () => void;
  close: () => void;
  ask: (text: string) => void;
  pendingInput: string;
  sendMessageRef: React.MutableRefObject<((text: string) => void) | null>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChatState>("closed");
  const [pendingInput, setPendingInput] = useState("");
  const sendMessageRef = useRef<((text: string) => void) | null>(null);

  const toggle = useCallback(() => {
    setState((s) => (s === "closed" ? "open" : "closed"));
  }, []);

  const open = useCallback(() => setState("open"), []);
  const minimize = useCallback(() => setState("minimized"), []);
  const close = useCallback(() => setState("closed"), []);

  const ask = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPendingInput(trimmed);
    setState("open");
  }, []);

  return (
    <ChatContext.Provider
      value={{
        state,
        setState,
        toggle,
        open,
        minimize,
        close,
        ask,
        pendingInput,
        sendMessageRef,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
