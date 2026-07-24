import { describe, expect, it } from "vitest";
import { chatErrorMessage, guardChatTransport, guardReadableStream, isClosedReadableStreamError, isQuotaError, QUOTA_ERROR_MESSAGE } from "./chat-stream";

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
  it("recognizes provider quota failures as non-transient", () => {
    const error = new Error("AI_APICallError: You exceeded your current quota, please check your plan and billing details.");
    expect(isQuotaError(error)).toBe(true);
    expect(chatErrorMessage(error)).toBe(QUOTA_ERROR_MESSAGE);
    expect(isQuotaError(new Error("rate limit exceeded temporarily"))).toBe(false);
  });

  it("recognizes the Trigger cancellation error", () => {
    expect(
      isClosedReadableStreamError(
        new Error("Failed to execute 'enqueue' on 'ReadableStreamDefaultController': Cannot enqueue a chunk into a closed readable stream"),
      ),
    ).toBe(true);
    expect(isClosedReadableStreamError(new Error("network failed"))).toBe(false);
  });

  it("recognizes the errored-stream close error variant", () => {
    expect(
      isClosedReadableStreamError(
        new Error("Failed to execute 'close' on 'ReadableStreamDefaultController': Cannot close an errored readable stream"),
      ),
    ).toBe(true);
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

  it("swallows a close-on-errored-stream error and settles cleanly", async () => {
    const source = new ReadableStream<number>({
      start(controller) {
        controller.error(new Error("Cannot close an errored readable stream"));
      },
    });

    await expect(readAll(guardReadableStream(source))).resolves.toEqual([]);
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
