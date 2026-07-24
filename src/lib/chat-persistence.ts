import type { UIMessage } from "ai";

export type ChatVisibilityState = "closed" | "minimized" | "open";

export interface FloatingChatSession {
  chatId: string;
  messages: UIMessage[];
  detached: boolean;
  drawerWidth: number;
  position: { x: number; y: number };
}

const VISIBILITY_STORAGE_KEY = "attention-terminal:floating-chat-visibility:v1";
const SESSION_STORAGE_KEY = "attention-terminal:floating-chat-session:v1";

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

const DEFAULT_SESSION: FloatingChatSession = {
  chatId: "",
  messages: [],
  detached: false,
  drawerWidth: 420,
  position: { x: 0, y: 0 },
};

export function loadChatVisibility(storage: MinimalStorage | undefined | null): ChatVisibilityState {
  if (!storage) return "closed";
  try {
    const raw = storage.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) return "closed";
    const parsed = JSON.parse(raw) as unknown;
    return parsed === "closed" || parsed === "minimized" || parsed === "open" ? parsed : "closed";
  } catch {
    return "closed";
  }
}

export function saveChatVisibility(storage: MinimalStorage | undefined | null, state: ChatVisibilityState): void {
  if (!storage) return;
  try {
    storage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // UI state is non-critical and must never break the chat surface.
  }
}

export function loadFloatingChatSession(storage: MinimalStorage | undefined | null): FloatingChatSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingChatSession> | null;
    if (!parsed || typeof parsed !== "object") return null;

    const chatId = typeof parsed.chatId === "string" && parsed.chatId.trim() ? parsed.chatId : "";
    const messages = Array.isArray(parsed.messages) ? (parsed.messages as UIMessage[]) : [];
    const detached = typeof parsed.detached === "boolean" ? parsed.detached : DEFAULT_SESSION.detached;
    const drawerWidth = clampDrawerWidth(parsed.drawerWidth);
    const position = sanitizePosition(parsed.position);

    return { chatId, messages, detached, drawerWidth, position };
  } catch {
    return null;
  }
}

export function saveFloatingChatSession(
  storage: MinimalStorage | undefined | null,
  session: FloatingChatSession,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        chatId: session.chatId,
        messages: session.messages,
        detached: session.detached,
        drawerWidth: clampDrawerWidth(session.drawerWidth),
        position: sanitizePosition(session.position),
      }),
    );
  } catch {
    // Chat history persistence is best-effort; localStorage quota/private mode
    // must not break the live chat surface.
  }
}

export function createFallbackChatId(): string {
  return `attention-chat-${crypto.randomUUID()}`;
}

export function clampDrawerWidth(input: unknown): number {
  const value = typeof input === "number" && Number.isFinite(input) ? input : DEFAULT_SESSION.drawerWidth;
  return Math.min(720, Math.max(320, value));
}

function sanitizePosition(input: unknown): { x: number; y: number } {
  if (!input || typeof input !== "object") return DEFAULT_SESSION.position;
  const raw = input as Partial<{ x: unknown; y: unknown }>;
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.max(0, raw.x) : DEFAULT_SESSION.position.x;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.max(0, raw.y) : DEFAULT_SESSION.position.y;
  return { x, y };
}
