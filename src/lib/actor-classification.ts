// Actor classification SQL fragment builders.
//
// gh_actor_classification is a ReplacingMergeTree dimension keyed by
// actor_login that stores the GitHub API's real account type (User, Bot,
// Organization). The refreshActorClassification Trigger.dev job populates it.
// These helpers generate the LEFT JOIN + filter clause so call sites don't
// repeat the fallback logic.

export function classificationJoin(tableAlias: string): string {
  return `LEFT JOIN (
    SELECT actor_login, argMax(actor_type, fetched_at) AS actor_type
    FROM gh_actor_classification
    GROUP BY actor_login
  ) cls ON cls.actor_login = ${tableAlias}.actor_login`;
}

export function notBotFilter(tableAlias: string): string {
  return `(cls.actor_type IN ('User', 'Organization') OR (cls.actor_type = '' AND lower(${tableAlias}.actor_login) NOT LIKE '%[bot]%'))`;
}

export function isBotFilter(tableAlias: string): string {
  return `cls.actor_type = 'Bot' OR lower(${tableAlias}.actor_login) LIKE '%[bot]%'`;
}

export function isBotExpr(tableAlias: string): string {
  return `coalesce(cls.actor_type, '') = 'Bot' OR lower(${tableAlias}.actor_login) LIKE '%[bot]%' AS is_bot`;
}
