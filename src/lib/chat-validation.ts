export function hasUserMessage(messages: readonly { role?: string }[]): boolean {
  return messages.some((message) => message.role === "user");
}
