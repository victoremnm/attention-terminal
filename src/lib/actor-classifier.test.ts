import { describe, expect, it, vi, beforeEach } from "vitest";
import { classifyActor, lookupActorClassification, seedActorClassifications } from "./actor-classifier";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  insert: vi.fn(),
  ensureTablesExist: vi.fn(),
}));

vi.mock("./clickhouse", () => ({
  clickhouse: { query: mocks.query },
  clickhouseInsert: { insert: mocks.insert },
  ensureTablesExist: mocks.ensureTablesExist,
}));

describe("classifyActor heuristic rules", () => {
  it("classifies GitHub App [bot] brackets with 1.0 confidence", () => {
    const res = classifyActor("dependabot[bot]");
    expect(res.isBot).toBe(true);
    expect(res.confidence).toBe(1.0);
    expect(res.reason).toBe("github_app_bracket");
  });

  it("classifies known automation accounts with 0.99 confidence", () => {
    const res1 = classifyActor("copilot");
    expect(res1.isBot).toBe(true);
    expect(res1.reason).toBe("known_automation");

    const res2 = classifyActor("github-actions");
    expect(res2.isBot).toBe(true);

    const res3 = classifyActor("web-flow");
    expect(res3.isBot).toBe(true);
  });

  it("classifies -bot and -app suffixes correctly", () => {
    const resBot = classifyActor("my-custom-bot");
    expect(resBot.isBot).toBe(true);
    expect(resBot.reason).toBe("bot_suffix");

    const resApp = classifyActor("ci-helper-app");
    expect(resApp.isBot).toBe(true);
    expect(resApp.reason).toBe("app_suffix");
  });

  it("classifies human logins correctly", () => {
    const res = classifyActor("torvalds");
    expect(res.isBot).toBe(false);
    expect(res.confidence).toBe(0.85);
    expect(res.reason).toBe("human_login");
  });

  it("handles empty logins safely", () => {
    const res = classifyActor("  ");
    expect(res.isBot).toBe(false);
    expect(res.reason).toBe("empty_login");
  });
});

describe("lookupActorClassification and seedActorClassifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTablesExist.mockResolvedValue(undefined);
  });

  it("returns classified data from ClickHouse when present", async () => {
    mocks.query.mockResolvedValueOnce({
      json: async () => [
        {
          actor_login: "custom-automation",
          is_bot: 1,
          confidence: 0.95,
          reason: "github_api_type",
          updated_at: "2026-07-24 12:00:00",
        },
      ],
    });

    const res = await lookupActorClassification("custom-automation");
    expect(res.actor_login).toBe("custom-automation");
    expect(res.is_bot).toBe(true);
    expect(res.confidence).toBe(0.95);
    expect(res.reason).toBe("github_api_type");
  });

  it("falls back to local classifyActor when ClickHouse query returns no rows", async () => {
    mocks.query.mockResolvedValueOnce({
      json: async () => [],
    });

    const res = await lookupActorClassification("renovate");
    expect(res.actor_login).toBe("renovate");
    expect(res.is_bot).toBe(true);
    expect(res.reason).toBe("known_automation");
  });

  it("seeds classifications into ClickHouse table", async () => {
    mocks.insert.mockResolvedValueOnce(undefined);

    const count = await seedActorClassifications(["octocat", "dependabot[bot]", "octocat"]);
    expect(count).toBe(2); // deduplicated
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "curated.gh_actor_classifier",
        values: expect.arrayContaining([
          expect.objectContaining({ actor_login: "octocat", is_bot: 0 }),
          expect.objectContaining({ actor_login: "dependabot[bot]", is_bot: 1 }),
        ]),
      })
    );
  });
});
