import { describe, expect, it } from "vitest";
import { getLastUserMessage, hasUserMessage } from "./chat-validation";

describe("hasUserMessage", () => {
  it("accepts a conversation containing a user message", () => {
    expect(hasUserMessage([{ role: "assistant" }, { role: "user" }])).toBe(true);
  });

  it("rejects empty and assistant-only histories", () => {
    expect(hasUserMessage([])).toBe(false);
    expect(hasUserMessage([{ role: "assistant" }])).toBe(false);
  });

  it("returns the latest user message id and text for a submit retry", () => {
    expect(getLastUserMessage([
      { id: "old", role: "user", parts: [{ type: "text", text: "old" }] },
      { id: "assistant", role: "assistant", parts: [{ type: "text", text: "answer" }] },
      { id: "latest", role: "user", parts: [{ type: "text", text: "what's new?" }] },
    ])).toEqual({ id: "latest", text: "what's new?" });
  });

  it("rejects a user message without text", () => {
    expect(getLastUserMessage([{ id: "latest", role: "user", parts: [{ type: "tool" }] }])).toBeUndefined();
  });
});
