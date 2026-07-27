/**
 * Seed test data into the firehose pipeline for local development and CI verification.
 *
 * Usage: npx tsx scripts/seed-firehose.ts
 *
 * Inserts 5 sample events matching the GH Archive schema into
 * default.github_events_stream, then verifies the materialized
 * views (curated.event_volume_hourly, curated.event_volume_daily,
 * curated.event_timeline) picked them up.
 */
import { clickhouse, clickhouseInsert, selectRows } from "../src/lib/clickhouse";

const SEED_EVENTS = [
  {
    event_id: 990000001,
    event_type: "PushEvent",
    actor_login: "seed-bot",
    actor_avatar: "https://avatars.githubusercontent.com/u/1?v=4",
    repo_name: "seed-org/seed-repo",
    owner: "seed-org",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    action: "",
    ref_type: "branch",
    number: 0,
    title: null,
    payload: '{"push_id":123,"ref":"refs/heads/main","head":"abc123","before":"def456","repository_id":1}',
  },
  {
    event_id: 990000002,
    event_type: "WatchEvent",
    actor_login: "seed-star",
    actor_avatar: "https://avatars.githubusercontent.com/u/2?v=4",
    repo_name: "seed-org/seed-repo",
    owner: "seed-org",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    action: "started",
    ref_type: "",
    number: 0,
    title: null,
    payload: '{"action":"started"}',
  },
  {
    event_id: 990000003,
    event_type: "PullRequestEvent",
    actor_login: "seed-pr",
    actor_avatar: "https://avatars.githubusercontent.com/u/3?v=4",
    repo_name: "seed-org/seed-repo",
    owner: "seed-org",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    action: "opened",
    ref_type: "",
    number: 42,
    title: null,
    payload: '{"action":"opened","number":42,"pull_request":{"url":"https://api.github.com/repos/seed-org/seed-repo/pulls/42","id":1,"number":42}}',
  },
  {
    event_id: 990000004,
    event_type: "IssuesEvent",
    actor_login: "seed-issue",
    actor_avatar: "https://avatars.githubusercontent.com/u/4?v=4",
    repo_name: "seed-org/seed-repo",
    owner: "seed-org",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    action: "opened",
    ref_type: "",
    number: 7,
    title: null,
    payload: '{"action":"opened","number":7,"issue":{"url":"https://api.github.com/repos/seed-org/seed-repo/issues/7"}}',
  },
  {
    event_id: 990000005,
    event_type: "CreateEvent",
    actor_login: "seed-create",
    actor_avatar: "https://avatars.githubusercontent.com/u/5?v=4",
    repo_name: "seed-org/new-repo",
    owner: "seed-org",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    action: "",
    ref_type: "repository",
    number: 0,
    title: null,
    payload: '{"ref":"new-repo","ref_type":"repository","full_ref":"refs/heads/main","master_branch":"main","description":"A new repo","pusher_type":"user"}',
  },
];

async function seed() {
  console.log("Seeding firehose test data...");

  await clickhouseInsert.insert({
    table: "default.github_events_stream",
    values: SEED_EVENTS,
    format: "JSONEachRow",
  });

  console.log(`Inserted ${SEED_EVENTS.length} events into default.github_events_stream`);

  // Verify MVs picked them up
  const [{ volume_count }] = await selectRows<{ volume_count: string }>(
    "SELECT toString(count()) AS volume_count FROM curated.event_volume_hourly WHERE repo_name = 'seed-org/seed-repo'"
  );
  console.log(`curated.event_volume_hourly rows for seed-org/seed-repo: ${volume_count}`);

  const [{ timeline_count }] = await selectRows<{ timeline_count: string }>(
    "SELECT toString(count()) AS timeline_count FROM curated.event_timeline WHERE repo_name = 'seed-org/seed-repo'"
  );
  console.log(`curated.event_timeline rows for seed-org/seed-repo: ${timeline_count}`);

  const [{ daily_count }] = await selectRows<{ daily_count: string }>(
    "SELECT toString(count()) AS daily_count FROM curated.event_volume_daily WHERE repo_name = 'seed-org/seed-repo'"
  );
  console.log(`curated.event_volume_daily rows for seed-org/seed-repo: ${daily_count}`);

  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
