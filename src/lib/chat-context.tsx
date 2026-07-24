"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getSafeLocalStorage, loadChatVisibility, saveChatVisibility, type ChatVisibilityState } from "./chat-persistence";

type ChatContextValue = {
  state: ChatVisibilityState;
  setState: (state: ChatVisibilityState) => void;
  toggle: () => void;
  open: () => void;
  minimize: () => void;
  close: () => void;
  ask: (text: string) => void;
  pendingInput: string;
  clearPendingInput: () => void;
  sendMessageRef: React.MutableRefObject<((text: string) => void) | null>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChatVisibilityState>("closed");
  const [pendingInput, setPendingInput] = useState("");
  const sendMessageRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    const storage = getSafeLocalStorage();
    setState(loadChatVisibility(storage));
  }, []);

  useEffect(() => {
    const storage = getSafeLocalStorage();
    saveChatVisibility(storage, state);
  }, [state]);

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

  const clearPendingInput = useCallback(() => setPendingInput(""), []);

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
        clearPendingInput,
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
