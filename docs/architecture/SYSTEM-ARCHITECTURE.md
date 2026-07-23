# Attention Terminal — End-to-End System Architecture

> **Architectural Blueprint & Flow Diagrams (Inputs $\rightarrow$ Processing $\rightarrow$ Data $\rightarrow$ Backend $\rightarrow$ Frontend)**

---

## 1. High-Level Architecture Overview

Attention Terminal is a real-time, LLM-powered telemetry and analytics dashboard for open-source developer activity. It ingests massive raw event streams from GitHub and Hacker News into ClickHouse, processes high-frequency metrics through background tasks and materialized views, and serves narrative-driven SVG visualizations through a Next.js App Router interface.

```mermaid
flowchart TD
    subgraph Inputs["1. INPUT LAYER"]
        GH["GitHub Archive Stream\n(Push, PR, Issues, Stars)"]
        HN["Hacker News API & Algolia\n(Top Stories, Comments)"]
        USER["User Chat Prompts &\nInteractions"]
    end

    subgraph Processing["2. PROCESSING LAYER"]
        TRIGGER["Trigger.dev v3 Tasks\n(Scheduled Ingestion & Enrichment)"]
        DBT["dbt Models &\nAnalytical Transformations"]
        GOOSE["Goose DDL Migrations\n(Versioned Schema Deployments)"]
    end

    subgraph Data["3. DATA LAYER (ClickHouse)"]
        RAW["Raw Telemetry Tables\n(github_events, hn_stories)"]
        MV["Materialized Views &\nSkipping Indexes"]
        SYSTEM["System Telemetry Tables\n(subagent_runs, session_learnings)"]
    end

    subgraph Backend["4. BACKEND LAYER (Next.js App Router)"]
        ROUTER["API Endpoint Handlers\n(/api/chat, /api/trending, /api/ticker)"]
        AGENTS["Data Retrieval Agents &\nAI Prompt System"]
        CH_CLIENT["ClickHouse Client Pool &\nFail-Open Spooler"]
    end

    subgraph Frontend["5. FRONTEND LAYER (React & Next.js Client)"]
        TERMINAL["Attention Terminal UI\n(Geist Monospaced Theme)"]
        CANVAS["Morphing Canvas &\nSVG Chart Primitives"]
        EXPORTER["Asset Export Engine\n(Copy Markdown & HTML)"]
    end

    GH --> TRIGGER
    HN --> TRIGGER
    TRIGGER --> DBT
    GOOSE --> RAW
    DBT --> RAW
    RAW --> MV
    SYSTEM --> CH_CLIENT

    USER --> ROUTER
    ROUTER --> AGENTS
    AGENTS --> CH_CLIENT
    CH_CLIENT --> RAW
    CH_CLIENT --> MV

    ROUTER --> TERMINAL
    TERMINAL --> CANVAS
    CANVAS --> EXPORTER
```

---

## 2. Ingestion & Processing Pipeline (Inputs $\rightarrow$ Processing $\rightarrow$ Data)

The processing layer transforms raw external events into structured ClickHouse analytical tables. Background jobs run on Trigger.dev v3, executing streaming inserts and continuous aggregations.

```mermaid
sequenceDiagram
    autonumber
    participant GH as GitHub / HN APIs
    participant TD as Trigger.dev v3 Worker
    participant CH as ClickHouse DB
    participant MV as Materialized Views

    TD->>GH: Poll high-frequency event stream (1min interval)
    GH-->>TD: Return payload (JSON/NDJSON events)
    TD->>TD: Lowercase actor logins & filter bot accounts
    TD->>CH: Async batch INSERT INTO github_events
    CH->>MV: Trigger MV backfill (gh_repo_activity_feed_mv)
    MV-->>CH: Update hourly & 30-day aggregate projections
```

### Pseudo-Medallion Data Architecture (Bronze $\rightarrow$ Silver $\rightarrow$ Gold)

Instead of a traditional Kimball star schema (which introduces expensive joins in real-time OLAP queries), Attention Terminal structures data using a **Pseudo-Medallion Architecture**:

```mermaid
flowchart TD
    BRONZE["Bronze Layer (Raw Ingestion)\ngithub_events / hn_stories\nAppend-only JSON event stream"] --> SILVER
    SILVER["Silver Layer (Cleansed Facts & Indexes)\nFiltered bot accounts (lower(actor_login) NOT LIKE '%[bot]%')\nToken bloom filter index (idx_github_events_actor_login)"] --> GOLD
    GOLD["Gold Layer (Rollup Projections)\n_hourly, _daily, _weekly AggregatingMergeTrees\ngh_repo_activity_feed_mv / gh_repo_period_rollups"]
```

1. **Bronze (Raw Append-Only)**: Ingests GitHub Archive and Hacker News raw event payloads at high throughput into `github_events` and `hn_stories`.
2. **Silver (Cleansed & Indexed Facts)**: Cleansed event facts utilizing `idx_github_events_actor_login` token bloom filter skipping indexes to filter bot traffic (`[bot]`, `copilot`, `dependabot`) without full-table scans.
3. **Gold (AggregatingMergeTree Rollups)**: Continuous rollups pre-computed into `_hourly`, `_daily`, and `_weekly` `AggregatingMergeTree` tables and Materialized Views (`gh_repo_activity_feed_mv`, `gh_repo_period_rollups`), reducing query scan sizes by >95%.
4. **Goose Schema Migrations**: All ClickHouse DDL transformations are version-controlled via **Goose DDL migrations** (`migrations/*.sql` + `./scripts/migrate.sh`) and automatically deployed via CD on merge to `main`.

### Data Layer Schema Map

```mermaid
erDiagram
    github_events {
        DateTime created_at PK
        String repo_name
        String actor_login
        String type
        String payload
    }
    gh_repo_activity_feed {
        DateTime window_start PK
        String repo_name
        UInt64 push_count
        UInt64 pr_count
        UInt64 issue_count
        UInt64 star_count
    }
    subagent_runs {
        DateTime ts PK
        String session_id
        String prompt_id
        String model
        UInt64 latency_ms
        UInt64 input_tokens
        UInt64 output_tokens
        Float64 cost_usd
        UInt8 ok
    }
    session_learnings {
        DateTime ts PK
        String session
        String slug
        String category
        String learning
        Array_String tags
    }

    github_events ||--o{ gh_repo_activity_feed : "materializes into"
    subagent_runs ||--o{ session_learnings : "correlates session telemetry"
```

---

## 3. Backend Agent Routing & Query Architecture

When a user submits a query to `/api/chat` or requests a repo drilldown, the backend orchestrates data retrieval through specialized AI prompt agents and executes optimized ClickHouse queries.

```mermaid
flowchart LR
    subgraph Client
        REQ["User Question / Prompt"]
    end

    subgraph NextJS["Next.js Server Runtime"]
        API["/api/chat Handler"]
        AGENT["Data Retrieval Agent"]
        TEMPLATE["Query Selector & SQL Generator"]
    end

    subgraph ClickHouse["ClickHouse Database"]
        INDEX["Skipping Index Scan\n(idx_github_events_actor_login)"]
        EXEC["Query Execution Engine"]
    end

    REQ --> API
    API --> AGENT
    AGENT --> TEMPLATE
    TEMPLATE --> INDEX
    INDEX --> EXEC
    EXEC --> API
```

---

## 4. Frontend Component & Morphing Canvas Architecture

The frontend renders analytical answers via the **Morphing Canvas**. Based on the `visualizationType` returned in the render payload, the adapter routes data to dedicated Tufte-aligned SVG chart primitives.

```mermaid
flowchart TD
    PAYLOAD["Render Payload\n(RenderPayload Schema)"] --> ADAPTER["buildMorphingChart Adapter"]

    ADAPTER -->|Bar Chart / Nominal| BAR["HorizontalBarChart / VerticalBarChart"]
    ADAPTER -->|Pie Chart / Donut| PIE["PieChart\n(7 Slices Cap + Other Ring)"]
    ADAPTER -->|Stacked Bar| STACK["StackedBarChart\n(Global Key Color Mapping)"]
    ADAPTER -->|Waterfall / Progression| WATER["WaterfallChart\n(Delta & Total Steps)"]
    ADAPTER -->|Treemap / Volume| TREE["TreemapChart\n(Proportional Tile Grid)"]
    ADAPTER -->|Scatter Correlation| SCATTER["DevScatterChart\n(Commits vs PR Merges)"]

    BAR --> RENDER["Rendered Morphing Card"]
    PIE --> RENDER
    STACK --> RENDER
    WATER --> RENDER
    TREE --> RENDER
    SCATTER --> RENDER

    RENDER --> COPY["Asset Exporter\n(Copy Markdown / Copy HTML)"]
```

---

## 5. System Design Principles Summary

| Layer | Primary Responsibilities | Core Architectural Choice |
| :--- | :--- | :--- |
| **1. Inputs** | Event collection from GitHub Archive, HN, user chat | Asynchronous background polling via Trigger.dev |
| **2. Processing** | Stream parsing, bot filtering, schema migrations | Goose DDL migrations & dbt models |
| **3. Data** | Fast OLAP analytics, telemetry tracking, session memory | ClickHouse with skipping indexes & `FINAL` deduplication |
| **4. Backend** | API routing, AI agent orchestration, ClickHouse pool | Next.js App Router + streaming JSON responses |
| **5. Frontend** | Visualization, responsive layout, markdown/HTML export | Tufte data-ink maximized hand-rolled SVG primitives |
