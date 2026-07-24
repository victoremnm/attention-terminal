// A fixed phrase/synonym book for the daily-skinny subject taxonomy (see
// migrations/20260724000001_database_families.sql's multiIf() subject
// classification) plus a couple of informally-tracked categories that don't
// map to one literal table/column name. Static and dependency-free by
// design (see agent-prompt.ts's header comment) rather than a live
// ClickHouse lookup -- the taxonomy changes rarely and a query-time
// dependency here would be one more thing that can fail mid-chat.
//
// Update this list whenever a new subject is added to the daily-skinny
// taxonomy migration, or when a slangy user phrasing repeatedly gets
// mis-searched (e.g. "claw" not matching any repo_name literally).

export type SubjectSynonymEntry = {
  subject: string;
  synonyms: string[];
  note?: string;
};

export const SUBJECT_SYNONYMS: SubjectSynonymEntry[] = [
  { subject: "ClickHouse", synonyms: ["clickhouse", "CH", "click house"] },
  { subject: "Bun", synonyms: ["bun", "oven-sh/bun", "oven"] },
  { subject: "Deno", synonyms: ["deno", "denoland/deno"] },
  { subject: "Rust", synonyms: ["rust", "rust-lang"] },
  { subject: "React", synonyms: ["react", "facebook/react"] },
  { subject: "Next.js", synonyms: ["next.js", "nextjs", "next", "vercel/next.js"] },
  { subject: "Tailwind CSS", synonyms: ["tailwind", "tailwindcss", "tailwindlabs/tailwindcss"] },
  { subject: "Llama", synonyms: ["llama", "meta llama"] },
  { subject: "Qwen", synonyms: ["qwen"] },
  { subject: "Postgres 18", synonyms: ["postgres", "postgresql", "pg"] },
  { subject: "SQLite", synonyms: ["sqlite"] },
  { subject: "Graphify", synonyms: ["graphify", "graphify-labs/graphify"] },
  {
    subject: "Attention Terminal",
    synonyms: ["attention terminal", "attention", "clickhouse-trigger-hackathon", "victoremnm/attention-terminal"],
  },
  {
    subject: "claw",
    synonyms: [
      "claw", "openclaw", "openclaw/openclaw", "the lobster way",
      "hermes-agent", "nousresearch/hermes-agent",
      "cc-switch", "farion1231/cc-switch",
      "claude-mem", "thedotmack/claude-mem",
    ],
    note: "AI-coding-agent tooling that riffs on Claude/Claude Code branding (\"claw\" plays on Claude, not a literal repo-name substring) — search repo_name/description with ILIKE across these known names plus '%claw%', '%claude%', '%agent%' rather than assuming one canonical table or exact string match.",
  },
  {
    subject: "skills",
    synonyms: ["skills", "agent skills", "claude skills", "/skill", "graphify skill", "obsidian-skills", "kepano/obsidian-skills"],
    note: "Repos that ship a reusable \"skill\"/plugin for an AI coding agent (Claude Code, Cursor, Codex, Gemini CLI) — frequently forked, so recent fork count and description text (ILIKE '%skill%') are better signals than raw star count alone.",
  },
];

export function subjectSynonymsPromptSection(): string {
  const lines = SUBJECT_SYNONYMS.map((entry) => {
    const synonyms = entry.synonyms.join(", ");
    return `- "${entry.subject}" ~ ${synonyms}${entry.note ? ` — ${entry.note}` : ""}`;
  });
  return `Subject/phrase reference (a fixed synonym book — when the user's wording matches an entry here, build your search/filter from the synonyms listed rather than assuming their exact words are a literal column or table match):
${lines.join("\n")}`;
}
