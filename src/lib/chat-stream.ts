const CLOSED_STREAM_MESSAGES = [
  "Cannot enqueue a chunk into a closed readable stream",
  "Cannot close an errored readable stream",
];

export function isClosedReadableStreamError(error: unknown): boolean {
  return error instanceof Error && CLOSED_STREAM_MESSAGES.some((m) => error.message.includes(m));
}

/**
 * Trigger's transport can report a consumer cancellation as a stream error
 * when an SSE chunk races with stop/regenerate. Treat that specific failure as
 * normal stream completion so the AI SDK can settle the current request.
 */
export function guardReadableStream<T>(source: ReadableStream<T>): ReadableStream<T> {
  let reader: ReadableStreamDefaultReader<T> | undefined;
  let cancelled = false;

  return new ReadableStream<T>({
    start(controller) {
      void (async () => {
        try {
          reader = source.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done || cancelled) {
              if (!cancelled) try { controller.close(); } catch { /* already errored */ }
              return;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          if (cancelled || isClosedReadableStreamError(error) || (error instanceof Error && error.name === "AbortError")) {
            if (!cancelled) try { controller.close(); } catch { /* already errored */ }
            return;
          }
          controller.error(error);
        } finally {
          reader?.releaseLock();
        }
      })();
    },
    cancel(reason) {
      cancelled = true;
      return reader?.cancel(reason);
    },
  });
}

type SendMessages = (...args: never[]) => Promise<ReadableStream<unknown>>;

export function guardChatTransport<T extends { sendMessages: SendMessages }>(transport: T): T {
  const sendMessages = transport.sendMessages.bind(transport);
  const guardedSendMessages = async (...args: Parameters<T["sendMessages"]>) =>
    guardReadableStream(await sendMessages(...args));

  return new Proxy(transport, {
    get(target, property, receiver) {
      if (property === "sendMessages") return guardedSendMessages;
      return Reflect.get(target, property, receiver);
    },
  });
}
