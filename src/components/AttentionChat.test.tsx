/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatMock = vi.hoisted(() => ({
  useChat: vi.fn(),
  useTriggerChatTransport: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({ useChat: chatMock.useChat }));
vi.mock("@trigger.dev/sdk/chat/react", () => ({ useTriggerChatTransport: chatMock.useTriggerChatTransport }));
vi.mock("@/lib/chat-actions", () => ({
  mintChatAccessToken: vi.fn(),
  startChatSession: vi.fn(),
}));

import { AttentionChat } from "./AttentionChat";

function message(role: "user" | "assistant") {
  return { id: `${role}-1`, role, parts: [{ type: "text", text: "hello" }] };
}

describe("AttentionChat retry", () => {
  beforeEach(() => {
    chatMock.useTriggerChatTransport.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("runs one regenerate for repeated retry clicks without stopping first", () => {
    let resolveRegenerate: (() => void) | undefined;
    const regenerate = vi.fn(() => new Promise<void>((resolve) => { resolveRegenerate = resolve; }));
    const stop = vi.fn();
    chatMock.useChat.mockReturnValue({
      messages: [message("user"), message("assistant")],
      sendMessage: vi.fn(),
      stop,
      status: "error",
      error: new Error("stream failed"),
      regenerate,
    });

    render(<AttentionChat />);
    const retry = screen.getByRole("button", { name: "retry" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    resolveRegenerate?.();
  });

  it("does not regenerate an assistant-only history", () => {
    const regenerate = vi.fn();
    chatMock.useChat.mockReturnValue({
      messages: [message("assistant")],
      sendMessage: vi.fn(),
      stop: vi.fn(),
      status: "error",
      error: new Error("stream failed"),
      regenerate,
    });

    render(<AttentionChat />);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("there is no user message to retry");
  });
});
