/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatProvider, useChatContext } from "@/lib/chat-context";
import { FloatingChat, messageHasRenderAnswer, questionForAssistantMessage } from "./FloatingChat";
import type { UIMessage } from "ai";

function renderInProvider() {
  return render(
    <ChatProvider>
      <FloatingChat />
    </ChatProvider>
  );
}

// Helper to control chat state from a test
function StateControl() {
  const ctx = useChatContext();
  return (
    <>
      <button onClick={() => ctx.open()} data-testid="btn-open">open</button>
      <button onClick={() => ctx.minimize()} data-testid="btn-minimize">minimize</button>
      <button onClick={() => ctx.close()} data-testid="btn-close">close</button>
    </>
  );
}

function renderWithControls() {
  return render(
    <ChatProvider>
      <StateControl />
      <FloatingChat />
    </ChatProvider>
  );
}

describe("FloatingChat", () => {
  beforeEach(() => {
    // jsdom doesn't implement getBoundingClientRect well; mock it
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 1000,
      top: 0,
      right: 1420,
      bottom: 800,
      width: 420,
      height: 800,
      x: 1000,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
  });

  afterEach(() => cleanup());

  it("renders nothing when closed", () => {
    renderInProvider();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a drawer dialog when open", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("CHAT.AGENT")).toBeInTheDocument();
  });

  it("renders conversation starters when chat is empty", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(screen.getByText("what's new?")).toBeInTheDocument();
    expect(screen.getByText("show me the daily skinny")).toBeInTheDocument();
    expect(screen.getByText("what type of visualizations can you make?")).toBeInTheDocument();
  });

  it("shows a backdrop that closes the drawer on click", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    const backdrop = document.querySelector(".floating-chat-backdrop");
    expect(backdrop).toBeInTheDocument();
    act(() => fireEvent.click(backdrop!));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows minimized pill when minimized", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    act(() => screen.getByTestId("btn-minimize").click());
    const pill = document.querySelector(".floating-chat-minimized");
    expect(pill).toBeInTheDocument();
    // drawer should be hidden (minimized-hidden class)
    const drawer = document.querySelector(".floating-chat-drawer");
    expect(drawer?.className).toContain("minimized-hidden");
  });

  it("reopens from minimized pill", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    act(() => screen.getByTestId("btn-minimize").click());
    const pill = document.querySelector(".floating-chat-minimized");
    expect(pill).toBeInTheDocument();
    act(() => fireEvent.click(pill!));
    // drawer should be visible again
    const drawer = document.querySelector(".floating-chat-drawer");
    expect(drawer?.className).not.toContain("minimized-hidden");
  });

  it("keeps a detached drawer detached when minimized and reopened", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    const header = screen.getByText("CHAT.AGENT").closest("header");
    expect(header).toBeInTheDocument();

    act(() => fireEvent.pointerDown(header!, { button: 0, clientX: 1000, clientY: 10 }));
    expect(document.querySelector(".floating-chat-drawer")?.className).toContain("detached");

    act(() => screen.getByTestId("btn-minimize").click());
    act(() => fireEvent.click(document.querySelector(".floating-chat-minimized")!));

    expect(document.querySelector(".floating-chat-drawer")?.className).toContain("detached");
    expect(document.querySelector(".floating-chat-drawer")?.className).not.toContain("minimized-hidden");
  });

  it("renders minimize and close buttons in the drawer header", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close chat" })).toBeInTheDocument();
  });

  it("minimizes when the minimize button is clicked", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    act(() => screen.getByRole("button", { name: "Minimize chat" }).click());
    expect(document.querySelector(".floating-chat-minimized")).toBeInTheDocument();
  });

  it("closes when the close button is clicked", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    act(() => screen.getByRole("button", { name: "Close chat" }).click());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a resize handle", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(document.querySelector(".floating-chat-resize-handle")).toBeInTheDocument();
  });

  it("renders a status dot in the header", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(document.querySelector(".status-dot")).toBeInTheDocument();
  });

  it("header has grab cursor for drag", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    const header = screen.getByText("CHAT.AGENT").closest("header");
    expect(header).toHaveStyle({ cursor: "grab" });
  });

  it("chat input is present when drawer is open", () => {
    renderWithControls();
    act(() => screen.getByTestId("btn-open").click());
    expect(screen.getByPlaceholderText("ask about tech attention...")).toBeInTheDocument();
  });
});

describe("Answer spec v1 — prose gate + question echo helpers", () => {
  // Lightweight fake UIMessage-shaped objects. We exercise the pure helpers
  // (exported from FloatingChat) rather than the full chat transport, since the
  // gate decision is the load-bearing rule and doesn't need the network layer.
  function mkMessage(role: "user" | "assistant", parts: { type: string; text?: string }[]): UIMessage {
    return { id: `${role}-${Math.random()}`, role, parts } as unknown as UIMessage;
  }

  it("messageHasRenderAnswer is true only when a tool-renderAnswer part is present", () => {
    const withRender = mkMessage("assistant", [{ type: "tool-renderAnswer" }]);
    const withText = mkMessage("assistant", [{ type: "text", text: "some prose" }]);
    const user = mkMessage("user", [{ type: "text", text: "hi" }]);
    expect(messageHasRenderAnswer(withRender)).toBe(true);
    expect(messageHasRenderAnswer(withText)).toBe(false);
    expect(messageHasRenderAnswer(user)).toBe(false);
  });

  it("questionForAssistantMessage returns the most recent preceding user text", () => {
    const messages = [
      mkMessage("user", [{ type: "text", text: "is htmx hype or real?" }]),
      mkMessage("assistant", [{ type: "tool-renderAnswer" }]),
    ];
    expect(questionForAssistantMessage(messages, 1)).toBe("is htmx hype or real?");
  });

  it("questionForAssistantMessage returns undefined when the preceding user message has no text", () => {
    const messages = [
      mkMessage("user", [{ type: "tool-something" }]),
      mkMessage("assistant", [{ type: "tool-renderAnswer" }]),
    ];
    expect(questionForAssistantMessage(messages, 1)).toBeUndefined();
  });

  it("questionForAssistantMessage returns undefined for the first message", () => {
    const messages = [mkMessage("assistant", [{ type: "tool-renderAnswer" }])];
    expect(questionForAssistantMessage(messages, 0)).toBeUndefined();
  });
});
