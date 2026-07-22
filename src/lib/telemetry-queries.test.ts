import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichTelemetryRun, type SubagentRunRow } from "./telemetry-queries";

const logger = fileURLToPath(new URL("../../scripts/log-subagent-run.sh", import.meta.url));

function runFixture(overrides: string[], spool: string) {
  return spawnSync("bash", [logger, ...overrides], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLICKHOUSE_URL: "",
      CLAUDE_TELEMETRY_SPOOL: spool,
    },
  });
}

function fixture(overrides: Partial<SubagentRunRow> = {}): SubagentRunRow {
  return {
    ts: "2026-07-22 00:00:00.000",
    session_id: "session",
    prompt_id: "prompt",
    agent_id: "agent",
    agent_type: "explore",
    effort_level: "default",
    model: "glm-5.2:cloud",
    spec_preview: "inspect telemetry",
    result_preview: "done",
    latency_ms: 1000,
    input_tokens: 0,
    input_tokens_provenance: "estimated",
    output_tokens: 0,
    output_tokens_provenance: "estimated",
    cost_usd: 0,
    cost_provenance: "estimated",
    ok: 1,
    ...overrides,
  };
}

describe("telemetry usage provenance", () => {
  it("does not replace provider-reported zeroes with estimates", () => {
    const result = enrichTelemetryRun(
      fixture({
        input_tokens_provenance: "measured",
        output_tokens_provenance: "measured",
        cost_provenance: "measured",
      }),
    );

    expect(result.input_tokens).toBe(0);
    expect(result.output_tokens).toBe(0);
    expect(result.cost_usd).toBe(0);
    expect(result.input_tokens_provenance).toBe("measured");
    expect(result.output_tokens_provenance).toBe("measured");
    expect(result.cost_provenance).toBe("measured");
  });

  it("estimates only values marked as estimated and preserves provenance", () => {
    const result = enrichTelemetryRun(fixture());

    expect(result.input_tokens).toBeGreaterThan(0);
    expect(result.output_tokens).toBeGreaterThan(0);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.input_tokens_provenance).toBe("estimated");
    expect(result.output_tokens_provenance).toBe("estimated");
    expect(result.cost_provenance).toBe("estimated");
  });

  it("spools both records when ClickHouse is unavailable", () => {
    const directory = mkdtempSync(join(tmpdir(), "telemetry-provenance-"));
    const spool = join(directory, "spool.ndjson");

    try {
      const result = runFixture(
        ["--session-id", "session", "--prompt-id", "prompt", "--agent-id", "agent", "--spec", "spec", "--result", "result"],
        spool,
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("ClickHouse unavailable");
      const records = readFileSync(spool, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { table: string; row: Record<string, unknown> });
      expect(records.map((record) => record.table)).toEqual(["subagent_runs", "subagent_api_events"]);
      expect(records[0].row.input_tokens_provenance).toBe("estimated");
      expect(records[0].row.cost_provenance).toBe("estimated");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("spools failed ClickHouse inserts and remains fail-open", () => {
    const directory = mkdtempSync(join(tmpdir(), "telemetry-provenance-"));
    const spool = join(directory, "spool.ndjson");

    try {
      const result = spawnSync("bash", [logger, "--session-id", "session", "--prompt-id", "prompt", "--agent-id", "agent", "--spec", "spec", "--result", "result", "--input-tokens", "12", "--output-tokens", "4", "--cost-usd", "0"], {
        encoding: "utf8",
        env: {
          ...process.env,
          CLICKHOUSE_URL: "http://127.0.0.1:1",
          CLAUDE_TELEMETRY_SPOOL: spool,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("spooled record");
      const records = readFileSync(spool, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { table: string; row: Record<string, unknown> });
      expect(records).toHaveLength(2);
      expect(records[0].row.input_tokens_provenance).toBe("measured");
      expect(records[0].row.output_tokens_provenance).toBe("measured");
      expect(records[0].row.cost_provenance).toBe("measured");
      expect(records[0].row.cost_usd).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// Keep the shell test dependency visible during local setup; this also gives a
// clear error instead of a confusing JSON parse failure if jq is unavailable.
it("has jq available for the telemetry logger", () => {
  expect(() => execFileSync("jq", ["--version"], { stdio: "ignore" })).not.toThrow();
});
