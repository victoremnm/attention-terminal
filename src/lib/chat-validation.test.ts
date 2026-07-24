import { describe, expect, it } from "vitest";
import { hasUserMessage } from "./chat-validation";

describe("hasUserMessage", () => {
  it("accepts a conversation containing a user message", () => {
    expect(hasUserMessage([{ role: "assistant" }, { role: "user" }])).toBe(true);
  });

  it("rejects empty and assistant-only histories", () => {
    expect(hasUserMessage([])).toBe(false);
    expect(hasUserMessage([{ role: "assistant" }])).toBe(false);
  });
});
