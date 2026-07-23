import { describe, expect, it, vi } from "vitest";

import { isTransientClickHouseNetworkError, withClickHouseRetry } from "./clickhouse";

describe("ClickHouse connection recovery", () => {
  it("recognizes TLS/socket transport failures as retryable", () => {
    expect(
      isTransientClickHouseNetworkError(
        Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), {
          code: "ECONNRESET",
        })
      )
    ).toBe(true);
    expect(isTransientClickHouseNetworkError(new Error("Syntax error: failed at position 1"))).toBe(false);
  });

  it("resets the client and retries a transient failure", async () => {
    const holder = {
      get: vi.fn(() => ({})),
      proxy: {},
      reset: vi.fn(async () => undefined),
    };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket reset"), { code: "ECONNRESET" }))
      .mockResolvedValue("ok");

    await expect(withClickHouseRetry(holder, operation, "query", [0, 0])).resolves.toBe("ok");
    expect(holder.reset).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry ClickHouse query errors", async () => {
    const holder = {
      get: vi.fn(() => ({})),
      proxy: {},
      reset: vi.fn(async () => undefined),
    };
    const error = new Error("Syntax error");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withClickHouseRetry(holder, operation, "query", [0, 0])).rejects.toBe(error);
    expect(holder.reset).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
