"use client";

import { ChatProvider } from "@/lib/chat-context";
import { useChatContext } from "@/lib/chat-context";
import { FloatingChat } from "./FloatingChat";
import { ChatTrigger } from "./ChatTrigger";

function FloatingChatGate() {
  const ctx = useChatContext();
  if (ctx.state === "closed") return null;
  return <FloatingChat />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      {children}
      <FloatingChatGate />
      <ChatTrigger />
    </ChatProvider>
  );
}
