# ADR 0005: "Double-Click" Repo Drill-Down Card & Single-Pass Velocity Queries

- **Status**: Accepted
- **Date**: 2026-07-23
- **Context**: Issue #124 / Issue #180 (Double-Click Repo Drill-Down Component & ClickHouse Ingestion)

## Context & Problem Statement
When users explore repository activity on Attention Terminal, they need to transition seamlessly from high-level ecosystem trends to a granular **"Double-Click" Repo Drill-Down Card**. The system must surface 24-hour push velocity, commit density, code churn, and actor feeds in sub-second query speeds without firing multiple round-trip SQL queries.

## Decision Drivers & Technical Specifications

### 1. Single-Pass 24-Hour Velocity Query
By taking advantage of ClickHouse's flattened column store, all 24-hour hourly velocity metrics are fetched in a **single pass** using `countIf` and `sum` conditional aggregations over `created_at` timestamp buckets:

```sql
SELECT 
    toStartOfHour(created_at) AS hour,
    countIf(event_type = 'PushEvent') AS pushes,
    sum(push_size) AS total_commits,
    countIf(event_type = 'ForkEvent') AS forks,
    countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issues,
    countIf(event_type = 'WatchEvent') AS stars
FROM github_events 
WHERE repo_name = 'owner/repo' 
  AND created_at >= now() - INTERVAL 1 DAY
GROUP BY hour ORDER BY hour;
```

### 2. Push Preview Feed & Column Mapping
The push preview feed renders granular event payloads to inspect contributor activity:

| Metadata Field | ClickHouse Column | Analytical Purpose |
| :--- | :--- | :--- |
| **The Actor** | `actor_login` | Identifies who executed the push or pull request merge. |
| **Branch Target** | `ref` | Distinguishes direct `refs/heads/main` pushes from feature branch activity. |
| **Commit Density** | `push_size` vs `push_distinct_size` | Differentiates single massive commits from multi-commit streams. |
| **Code Churn** | `additions`, `deletions`, `changed_files` | Surface LOC churn on `PullRequestEvent` (when `merged = 1`). |
| **Contributor Status** | `author_association` | Classifies actor as `OWNER`, `MEMBER`, or `CONTRIBUTOR`. |

> **GHArchive Payload Constraint Note**: The ClickHouse schema drops raw commit message text arrays to save storage space, keeping counts (`push_size`). If exact commit message text is requested, the application performs a live fetch against the GitHub REST API using `commit_id`.

### 3. Structural Design of the Drill-Down Card
The card enforces a 4-tier visual hierarchy:
1. **Header (Context)**: Repo Name, Total Stars, Primary Language Badge.
2. **Top Row (Hero KPIs)**: 24-hour deltas (`+42 Pushes`, `+120 Commits`, `+15 Forks`).
3. **Middle Section (Velocity Chart)**: Synchronized hourly cadence of pushes vs issues.
4. **Bottom Section (Push Feed)**: Scrollable list of latest pushes (`actor_login`, `ref`, `push_size` badge, timestamp).

## Decision Outcome
Accepted. Single-pass conditional aggregation queries and standard 4-tier card layouts implemented for repo drill-downs.
