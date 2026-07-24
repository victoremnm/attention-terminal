import { describe, expect, it } from "vitest";
import { guardChatTransport, guardReadableStream, isClosedReadableStreamError } from "./chat-stream";

async function readAll<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const values: T[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) return values;
    values.push(result.value);
  }
}

describe("chat stream guard", () => {
  it("recognizes the Trigger cancellation error", () => {
    expect(
      isClosedReadableStreamError(
        new Error("Failed to execute 'enqueue' on 'ReadableStreamDefaultController': Cannot enqueue a chunk into a closed readable stream"),
      ),
    ).toBe(true);
    expect(isClosedReadableStreamError(new Error("network failed"))).toBe(false);
  });

  it("turns a closed-controller source failure into completion", async () => {
    const source = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        setTimeout(() => controller.error(new Error("Cannot enqueue a chunk into a closed readable stream")), 0);
      },
    });

    await expect(readAll(guardReadableStream(source))).resolves.toEqual([1]);
  });

  it("preserves unrelated source failures", async () => {
    const source = new ReadableStream<number>({
      start(controller) {
        controller.error(new Error("upstream failed"));
      },
    });

    await expect(readAll(guardReadableStream(source))).rejects.toThrow("upstream failed");
  });

  it("guards the transport response without mutating the transport", async () => {
    const source = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.close();
      },
    });
    const transport = {
      sendMessages: async () => source,
      marker: "original",
    };

    const guarded = guardChatTransport(transport);

    expect(guarded).not.toBe(transport);
    expect(transport.marker).toBe("original");
    await expect(readAll(await guarded.sendMessages())).resolves.toEqual([1]);
  });
});
