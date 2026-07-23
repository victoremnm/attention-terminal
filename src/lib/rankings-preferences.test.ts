import { describe, expect, it } from "vitest";
import type { ActiveContributionRow, RepoWindowRow } from "./queries";
import {
  ACTIVE_COLUMNS,
  ATTENTION_COLUMNS,
  DEFAULT_ACTIVE_COLUMNS,
  DEFAULT_ATTENTION_COLUMNS,
  DEFAULT_PREFERENCES,
  activeMeasureValue,
  activeRowView,
  attentionMeasureValue,
  attentionRowView,
  compareByField,
  loadPreferences,
  modeConfig,
  moveColumn,
  nextSortDirection,
  sanitizePreferences,
  savePreferences,
  toggleColumn,
} from "./rankings-preferences";

const attentionRow: RepoWindowRow = {
  repo_name: "acme/widgets",
  owner: "acme",
  description: "Widget factory",
  language: "TypeScript",
  topics: ["widgets", "acme"],
  github_stars: 500,
  events: 120,
  actors: 8,
  pushes: 40,
  commits: 60,
  stars: 12,
  forks: 3,
  prsOpened: 5,
  prsMerged: 2,
  spark: [1, 2, 3],
};

const activeRow: ActiveContributionRow = {
  repoName: "acme/widgets",
  commits: 70,
  distinctCommits: 60,
  pushes: 40,
  substantivePushBuckets: 25,
  pushers: 4,
  humanPushers: 3,
  botPushers: 1,
  prsOpened: 5,
  prsMerged: 2,
  activityScore: 500,
  branchScope: "unknown",
  dependencyUpdateAttribution: "unknown",
};

function memoryStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    _store: store,
  };
}

describe("modeConfig", () => {
  it("resolves each known mode and falls back to attention", () => {
    expect(modeConfig("stars").querySort).toBe("stars");
    expect(modeConfig("active-pushes").source).toBe("active");
    expect(modeConfig("bogus" as never).key).toBe("attention");
  });
});

describe("loadPreferences / savePreferences", () => {
  it("returns defaults when storage is absent or empty", () => {
    expect(loadPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns defaults for corrupt JSON instead of throwing", () => {
    const storage = memoryStorage({ "attention-terminal:rankings-preferences:v1": "{not json" });
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips a valid, sanitized preference set", () => {
    const storage = memoryStorage();
    const prefs = {
      ...DEFAULT_PREFERENCES,
      mode: "active-commits" as const,
      sortField: "distinctCommits",
      sortDirection: "asc" as const,
      minStars: 50,
      hideBotOnly: true,
    };
    savePreferences(storage, prefs);
    expect(loadPreferences(storage)).toEqual(prefs);
  });

  it("silently no-ops when storage.setItem throws (quota/private mode)", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => savePreferences(storage, DEFAULT_PREFERENCES)).not.toThrow();
  });
});

describe("sanitizePreferences", () => {
  it("drops unknown columns and falls back to defaults if none remain", () => {
    const result = sanitizePreferences({
      mode: "stars",
      attentionColumns: ["forks", "not-a-real-column", "forks"],
      activeColumns: ["nonsense"],
    });
    expect(result.attentionColumns).toEqual(["forks"]);
    expect(result.activeColumns).toEqual([...DEFAULT_ACTIVE_COLUMNS]);
  });

  it("rejects a negative minStars and non-boolean hideBotOnly", () => {
    const result = sanitizePreferences({ minStars: -5, hideBotOnly: "yes" });
    expect(result.minStars).toBe(0);
    expect(result.hideBotOnly).toBe(false);
  });

  it("derives sortField from the mode's query sort when absent", () => {
    const result = sanitizePreferences({ mode: "forks" });
    expect(result.sortField).toBe("forks");
  });

  it("ignores non-object input", () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences("hello")).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("toggleColumn", () => {
  const order = ATTENTION_COLUMNS.map((c) => c.key);

  it("removes a visible column", () => {
    const result = toggleColumn([...DEFAULT_ATTENTION_COLUMNS], order, "commits");
    expect(result).toEqual(["pushes", "actors"]);
  });

  it("adds a hidden column back in canonical order, not append order", () => {
    const result = toggleColumn(["pushes"], order, "githubStars");
    expect(result).toEqual(["githubStars", "pushes"]);
  });
});

describe("moveColumn", () => {
  it("swaps a column left or right within bounds", () => {
    const columns: (typeof ACTIVE_COLUMNS)[number]["key"][] = ["distinctCommits", "substantivePushBuckets", "humanPushers"];
    expect(moveColumn(columns, "substantivePushBuckets", -1)).toEqual([
      "substantivePushBuckets",
      "distinctCommits",
      "humanPushers",
    ]);
    expect(moveColumn(columns, "substantivePushBuckets", 1)).toEqual([
      "distinctCommits",
      "humanPushers",
      "substantivePushBuckets",
    ]);
  });

  it("is a no-op at the boundaries or for an unknown key", () => {
    const columns = ["distinctCommits", "humanPushers"] as const;
    expect(moveColumn([...columns], "distinctCommits", -1)).toEqual([...columns]);
    expect(moveColumn([...columns], "humanPushers", 1)).toEqual([...columns]);
    expect(moveColumn([...columns], "botPushers" as never, 1)).toEqual([...columns]);
  });
});

describe("nextSortDirection", () => {
  it("defaults a newly clicked field to descending", () => {
    expect(nextSortDirection("events", "desc", "stars")).toBe("desc");
  });

  it("flips direction when clicking the already-active field", () => {
    expect(nextSortDirection("events", "desc", "events")).toBe("asc");
    expect(nextSortDirection("events", "asc", "events")).toBe("desc");
  });
});

describe("compareByField", () => {
  it("sorts numeric fields ascending and descending", () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect([...rows].sort(compareByField("n", "asc")).map((r) => r.n)).toEqual([1, 2, 3]);
    expect([...rows].sort(compareByField("n", "desc")).map((r) => r.n)).toEqual([3, 2, 1]);
  });

  it("falls back to locale string comparison for non-numeric fields", () => {
    const rows = [{ name: "banana" }, { name: "apple" }, { name: "cherry" }];
    expect([...rows].sort(compareByField("name", "asc")).map((r) => r.name)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("treats missing values as empty strings without throwing", () => {
    const rows = [{ name: "b" }, {}, { name: "a" }] as Array<{ name?: string }>;
    expect(() => [...rows].sort(compareByField("name", "asc"))).not.toThrow();
  });
});

describe("attentionMeasureValue / attentionRowView", () => {
  it("reads the events field even though it is not a toggleable column", () => {
    expect(attentionMeasureValue(attentionRow, "events")).toBe(120);
  });

  it("reads any toggleable column by field name", () => {
    expect(attentionMeasureValue(attentionRow, "forks")).toBe(3);
    expect(attentionMeasureValue(attentionRow, "prsMerged")).toBe(2);
  });

  it("builds a view with a primary value matching the sort field and requested chips", () => {
    const view = attentionRowView(attentionRow, "stars", ["pushes", "commits"]);
    expect(view.primaryLabel).toBe("stars");
    expect(view.primaryValue).toBe(12);
    expect(view.chips).toEqual([
      { key: "pushes", label: "pushes", value: 40 },
      { key: "commits", label: "commits", value: 60 },
    ]);
    expect(view.searchText).toContain("acme/widgets");
    expect(view.botOnly).toBe(false);
  });
});

describe("activeMeasureValue / activeRowView", () => {
  it("maps 'commits'/'pushes' sort fields to the anti-noise measures, not raw counts", () => {
    expect(activeMeasureValue(activeRow, "commits")).toBe(60); // distinctCommits, not raw commits (70)
    expect(activeMeasureValue(activeRow, "pushes")).toBe(25); // substantivePushBuckets, not raw pushes (40)
  });

  it("falls back to a direct column lookup for non-primary fields", () => {
    expect(activeMeasureValue(activeRow, "prsMerged")).toBe(2);
  });

  it("flags a repo as bot-only when every pusher observed was a bot", () => {
    const botOnlyRow = { ...activeRow, humanPushers: 0, botPushers: 2 };
    expect(activeRowView(botOnlyRow, "commits", []).botOnly).toBe(true);
    expect(activeRowView(activeRow, "commits", []).botOnly).toBe(false);
  });

  it("labels the primary value by the anti-noise measure name", () => {
    const view = activeRowView(activeRow, "pushes", ["humanPushers", "botPushers"]);
    expect(view.primaryLabel).toBe("substantive pushes");
    expect(view.primaryValue).toBe(25);
    expect(view.chips).toEqual([
      { key: "humanPushers", label: "human pushers", value: 3 },
      { key: "botPushers", label: "bot pushers", value: 1 },
    ]);
  });
});
