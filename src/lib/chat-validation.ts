export function hasUserMessage(messages: readonly { role?: string }[]): boolean {
  return messages.some((message) => message.role === "user");
}

type MessagePart = { type?: string; text?: string };

export function getLastUserMessage(
  messages: readonly { id?: string; role?: string; parts?: readonly MessagePart[] }[],
): { id: string; text: string } | undefined {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message?.id || !message.parts) return undefined;

  const text = message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
  return text ? { id: message.id, text } : undefined;
}
