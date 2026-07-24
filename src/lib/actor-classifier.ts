import { clickhouse, clickhouseInsert, ensureTablesExist } from "./clickhouse";

export interface ActorClassification {
  actor_login: string;
  is_bot: boolean;
  confidence: number;
  reason: string;
  updated_at?: string;
}

const KNOWN_BOT_LOGINS = new Set([
  "copilot",
  "github-actions",
  "dependabot",
  "renovate",
  "snyk-bot",
  "snyk",
  "codecov",
  "codecov-io",
  "semantic-release",
  "allcontributors",
  "allcontributors[bot]",
  "stale",
  "greenkeeper",
  "sonarcloud",
  "probot",
  "scala-steward",
  "k8s-ci-robot",
  "regro-cf-autotick-bot",
  "vercel",
  "netlify",
  "mergify",
  "web-flow",
]);

export function classifyActor(login: string): { isBot: boolean; confidence: number; reason: string } {
  const normalized = login.trim().toLowerCase();
  if (!normalized) {
    return { isBot: false, confidence: 0.5, reason: "empty_login" };
  }

  if (normalized.includes("[bot]")) {
    return { isBot: true, confidence: 1.0, reason: "github_app_bracket" };
  }

  if (KNOWN_BOT_LOGINS.has(normalized)) {
    return { isBot: true, confidence: 0.99, reason: "known_automation" };
  }

  if (normalized.endsWith("-bot") || normalized.endsWith("_bot")) {
    return { isBot: true, confidence: 0.95, reason: "bot_suffix" };
  }

  if (normalized.endsWith("-app") || normalized.endsWith("_app")) {
    return { isBot: true, confidence: 0.9, reason: "app_suffix" };
  }

  return { isBot: false, confidence: 0.85, reason: "human_login" };
}

export async function lookupActorClassification(actorLogin: string): Promise<ActorClassification> {
  const login = actorLogin.trim();
  if (!login) {
    return { actor_login: "", is_bot: false, confidence: 0.5, reason: "empty_login" };
  }

  try {
    await ensureTablesExist(["curated.gh_actor_classifier"]);
    const rs = await clickhouse.query({
      query: `
        SELECT actor_login, is_bot, confidence, reason, toString(updated_at) AS updated_at
        FROM curated.gh_actor_classifier FINAL
        WHERE actor_login = {login: String}
        LIMIT 1
      `,
      query_params: { login },
      format: "JSONEachRow",
    });
    const rows = await rs.json<ActorClassification>();
    if (rows.length > 0 && rows[0]) {
      return {
        actor_login: rows[0].actor_login,
        is_bot: Boolean(rows[0].is_bot),
        confidence: Number(rows[0].confidence),
        reason: rows[0].reason,
        updated_at: rows[0].updated_at,
      };
    }
  } catch {
    // Fallback to local heuristic if ClickHouse is unavailable or table unpopulated
  }

  const { isBot, confidence, reason } = classifyActor(login);
  return {
    actor_login: login,
    is_bot: isBot,
    confidence,
    reason,
  };
}

export async function seedActorClassifications(logins: string[]): Promise<number> {
  const unique = Array.from(new Set(logins.map((l) => l.trim()).filter(Boolean)));
  if (unique.length === 0) return 0;

  await ensureTablesExist(["curated.gh_actor_classifier"]);
  const now = new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

  const values = unique.map((login) => {
    const { isBot, confidence, reason } = classifyActor(login);
    return {
      actor_login: login,
      is_bot: isBot ? 1 : 0,
      confidence,
      reason,
      updated_at: now,
    };
  });

  await clickhouseInsert.insert({
    table: "curated.gh_actor_classifier",
    values,
    format: "JSONEachRow",
  });

  return values.length;
}
