import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Real ClickHouse round-trips: some reads scan millions of rows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
