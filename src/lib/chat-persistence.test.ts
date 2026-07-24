import { describe, expect, it } from "vitest";
import {
  clampDrawerWidth,
  loadChatVisibility,
  loadFloatingChatSession,
  saveChatVisibility,
  saveFloatingChatSession,
  type FloatingChatSession,
} from "./chat-persistence";

function makeStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

describe("chat-persistence", () => {
  it("defaults visibility to closed when storage is empty", () => {
    expect(loadChatVisibility(undefined)).toBe("closed");
    expect(loadChatVisibility(makeStorage())).toBe("closed");
  });

  it("round-trips visibility state", () => {
    const storage = makeStorage();
    saveChatVisibility(storage, "open");
    expect(loadChatVisibility(storage)).toBe("open");
  });

  it("loads and sanitizes a floating chat session snapshot", () => {
    const session: FloatingChatSession = {
      chatId: "chat_123",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] } as never],
      detached: true,
      drawerWidth: 999,
      position: { x: -12, y: 48 },
    };
    const storage = makeStorage();
    saveFloatingChatSession(storage, session);

    const loaded = loadFloatingChatSession(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.chatId).toBe("chat_123");
    expect(loaded?.detached).toBe(true);
    expect(loaded?.drawerWidth).toBe(720);
    expect(loaded?.position).toEqual({ x: 0, y: 48 });
    expect(loaded?.messages).toHaveLength(1);
  });

  it("clamps drawer width into the accepted range", () => {
    expect(clampDrawerWidth(200)).toBe(320);
    expect(clampDrawerWidth(500)).toBe(500);
    expect(clampDrawerWidth(999)).toBe(720);
  });
});
