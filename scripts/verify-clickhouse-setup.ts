import "dotenv/config";
import { clickhouse } from "../src/lib/clickhouse";

async function main() {
  console.log("=== ClickHouse Operational Verification ===");

  // 1. Check Databases
  console.log("\n1. Checking Database Taxonomy...");
  const dbRs = await clickhouse.query({
    query: "SHOW DATABASES",
    format: "JSONEachRow",
  });
  const dbs = ((await dbRs.json()) as Array<{ name: string }>).map((d) => d.name);
  console.log("   Found Databases:", dbs.join(", "));
  const expectedDbs = ["curated", "cleansed", "default", "raw", "internal"];
  for (const expected of expectedDbs) {
    const present = dbs.includes(expected);
    console.log(`   - Database '${expected}': ${present ? "✅ PRESENT" : "❌ MISSING"}`);
  }

  // 2. Check Roles
  console.log("\n2. Checking RBAC Roles...");
  try {
    const rolesRs = await clickhouse.query({
      query: "SELECT name FROM system.roles",
      format: "JSONEachRow",
    });
    const roles = ((await rolesRs.json()) as Array<{ name: string }>).map((r) => r.name);
    console.log("   Found Roles:", roles.join(", "));
    const expectedRoles = ["web_app_role", "telemetry_ingest_role", "pipeline_ingest_role"];
    for (const role of expectedRoles) {
      const present = roles.includes(role);
      console.log(`   - Role '${role}': ${present ? "✅ PRESENT" : "❌ MISSING"}`);
    }
  } catch (err: any) {
    console.log("   ⚠️ system.roles check skipped or restricted:", err.message);
  }

  // 3. Check Internal Telemetry Tables
  console.log("\n3. Checking Internal Telemetry Storage Tables...");
  const tablesRs = await clickhouse.query({
    query: "SELECT name FROM system.tables WHERE database = 'internal'",
    format: "JSONEachRow",
  });
  const internalTables = ((await tablesRs.json()) as Array<{ name: string }>).map((t) => t.name);
  console.log("   Found internal tables:", internalTables.join(", "));
  const expectedTelemetry = ["trigger_task_logs", "trigger_task_spans", "trigger_task_metrics", "subagent_runs"];
  for (const table of expectedTelemetry) {
    const present = internalTables.includes(table);
    console.log(`   - Table 'internal.${table}': ${present ? "✅ PRESENT" : "❌ MISSING"}`);
  }

  console.log("\n=== Operational Verification Complete ===");
}

main().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
