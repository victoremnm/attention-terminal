"use client";

import { ChatProvider } from "@/lib/chat-context";
import { FloatingChat } from "./FloatingChat";
import { ChatTrigger } from "./ChatTrigger";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      {children}
      <FloatingChat />
      <ChatTrigger />
    </ChatProvider>
  );
}
