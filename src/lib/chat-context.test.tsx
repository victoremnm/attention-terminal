/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatProvider, useChatContext } from "./chat-context";

function Consumer() {
  const ctx = useChatContext();
  return (
    <div>
      <span data-testid="state">{ctx.state}</span>
      <span data-testid="pending">{ctx.pendingInput}</span>
      <button data-testid="ask" onClick={() => ctx.ask("tell me about acme/widgets")}>ask</button>
      <button data-testid="ask-empty" onClick={() => ctx.ask("  ")}>ask-empty</button>
      <button data-testid="clear" onClick={() => ctx.clearPendingInput()}>clear</button>
      <button data-testid="open" onClick={() => ctx.open()}>open</button>
      <button data-testid="minimize" onClick={() => ctx.minimize()}>minimize</button>
      <button data-testid="close" onClick={() => ctx.close()}>close</button>
      <button data-testid="toggle" onClick={() => ctx.toggle()}>toggle</button>
      <button data-testid="set-open" onClick={() => ctx.setState("open")}>set-open</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ChatProvider>
      <Consumer />
    </ChatProvider>
  );
}

describe("ChatProvider", () => {
  afterEach(() => cleanup());

  it("starts in closed state with empty pending input", () => {
    renderProvider();
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    expect(screen.getByTestId("pending")).toHaveTextContent("");
  });

  it("open() sets state to open", () => {
    renderProvider();
    act(() => screen.getByTestId("open").click());
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("minimize() sets state to minimized", () => {
    renderProvider();
    act(() => screen.getByTestId("minimize").click());
    expect(screen.getByTestId("state")).toHaveTextContent("minimized");
  });

  it("close() sets state to closed", () => {
    renderProvider();
    act(() => screen.getByTestId("open").click());
    act(() => screen.getByTestId("close").click());
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("toggle() flips between closed and open", () => {
    renderProvider();
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    act(() => screen.getByTestId("toggle").click());
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    act(() => screen.getByTestId("toggle").click());
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("ask() sets pendingInput and opens the chat", () => {
    renderProvider();
    act(() => screen.getByTestId("ask").click());
    expect(screen.getByTestId("pending")).toHaveTextContent("tell me about acme/widgets");
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("ask() ignores whitespace-only text", () => {
    renderProvider();
    act(() => screen.getByTestId("ask-empty").click());
    expect(screen.getByTestId("pending")).toHaveTextContent("");
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("clearPendingInput() clears the pending input", () => {
    renderProvider();
    act(() => screen.getByTestId("ask").click());
    expect(screen.getByTestId("pending")).toHaveTextContent("tell me about acme/widgets");
    act(() => screen.getByTestId("clear").click());
    expect(screen.getByTestId("pending")).toHaveTextContent("");
  });

  it("setState() directly sets any state", () => {
    renderProvider();
    act(() => screen.getByTestId("set-open").click());
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("throws when useChatContext is used outside provider", () => {
    function NoProvider() {
      useChatContext();
      return null;
    }
    expect(() => render(<NoProvider />)).toThrow("useChatContext must be used within ChatProvider");
  });
});