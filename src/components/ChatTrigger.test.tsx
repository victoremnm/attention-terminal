/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatProvider, useChatContext } from "@/lib/chat-context";
import { ChatTrigger } from "./ChatTrigger";

function renderInProvider() {
  return render(
    <ChatProvider>
      <ChatTrigger />
    </ChatProvider>
  );
}

describe("ChatTrigger", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => cleanup());

  it("renders a floating chat trigger button", () => {
    renderInProvider();
    expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument();
  });

  it("shows onboarding tooltip when localStorage flag is absent", () => {
    renderInProvider();
    expect(screen.getByText(/Ask the terminal anything/i)).toBeInTheDocument();
  });

  it("does not show onboarding tooltip when already onboarded", () => {
    window.localStorage.setItem("attention-terminal:chat-onboarded", "1");
    renderInProvider();
    expect(screen.queryByText(/Ask the terminal anything/i)).not.toBeInTheDocument();
  });

  it("sets the onboarding flag and hides tooltip on first click", async () => {
    renderInProvider();
    const button = screen.getByRole("button", { name: "Open chat" });
    await act(() => fireEvent.click(button));
    expect(window.localStorage.getItem("attention-terminal:chat-onboarded")).toBe("1");
    expect(screen.queryByText(/Ask the terminal anything/i)).not.toBeInTheDocument();
  });

  it("has title attribute for hover tooltip", () => {
    renderInProvider();
    expect(screen.getByRole("button", { name: "Open chat" })).toHaveAttribute("title", "Ask the terminal");
  });

  it("hides FAB (data-hidden) after opening chat", async () => {
    renderInProvider();
    const button = screen.getByRole("button", { name: "Open chat" });
    expect(button).not.toHaveAttribute("data-hidden", "true");
    await act(() => fireEvent.click(button));
    // toggle: closed -> open, so FAB should now be hidden
    expect(button).toHaveAttribute("data-hidden", "true");
    expect(button).toHaveAttribute("aria-label", "Close chat");
  });
});