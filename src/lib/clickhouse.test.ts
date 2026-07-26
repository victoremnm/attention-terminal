import { describe, expect, it, vi } from "vitest";
import { missingTables, queryWithRetry } from "./clickhouse";

describe("clickhouse utility functions", () => {
  describe("queryWithRetry", () => {
    it("returns result on first try when successful", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const result = await queryWithRetry(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries transient ECONNRESET error and succeeds", async () => {
      const resetErr = new Error("read ECONNRESET");
      (resetErr as any).code = "ECONNRESET";

      const fn = vi.fn()
        .mockRejectedValueOnce(resetErr)
        .mockResolvedValueOnce("recovered");

      const result = await queryWithRetry(fn, 3);
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("throws non-transient errors immediately without retry", async () => {
      const syntaxErr = new Error("Syntax error");
      const fn = vi.fn().mockRejectedValue(syntaxErr);

      await expect(queryWithRetry(fn, 3)).rejects.toThrow("Syntax error");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("missingTables", () => {
    it("returns empty array for empty input", async () => {
      const missing = await missingTables([]);
      expect(missing).toEqual([]);
    });
  });
});
