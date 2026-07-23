import path from "node:path";
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias. Needed by any
    // test that imports a component/module using the alias (e.g.
    // RenderedAnswer.tsx importing "@/lib/render-payload").
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // Real ClickHouse round-trips: some reads scan millions of rows.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
