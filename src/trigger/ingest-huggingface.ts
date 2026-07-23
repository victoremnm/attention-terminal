import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, logIngest, selectRows } from "../lib/clickhouse";

const HF_API = "https://huggingface.co/api/models";
const SCAN_LIMIT = 40;

const SCANS = [
  { kind: "top-downloads", params: { sort: "downloads", direction: "-1" } },
  { kind: "top-liked", params: { sort: "likes", direction: "-1" } },
  { kind: "text-generation", params: { pipeline_tag: "text-generation", sort: "downloads", direction: "-1" } },
  { kind: "text-to-image", params: { pipeline_tag: "text-to-image", sort: "downloads", direction: "-1" } },
  { kind: "embeddings", params: { search: "embedding", sort: "downloads", direction: "-1" } },
  { kind: "qwen", params: { search: "qwen", sort: "downloads", direction: "-1" } },
  { kind: "llama", params: { search: "llama", sort: "downloads", direction: "-1" } },
  { kind: "flux", params: { search: "flux", sort: "likes", direction: "-1" } },
  { kind: "agents", params: { search: "agent", sort: "downloads", direction: "-1" } },
  { kind: "mcp", params: { search: "mcp", sort: "downloads", direction: "-1" } },
] as const;

interface HFModel {
  id?: string;
  modelId?: string;
  author?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  createdAt?: string;
  lastModified?: string;
  private?: boolean;
  gated?: boolean | string;
}

function chDateTime(value?: string | Date) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date(0);
  if (!Number.isFinite(date.getTime())) return "1970-01-01 00:00:00";
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function scanHour() {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d;
}

async function fetchModels(params: Record<string, string>) {
  const url = new URL(HF_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("limit", String(SCAN_LIMIT));

  const headers: HeadersInit = {};
  const token = process.env.HUGGINGFACE_TOKEN ?? process.env.HF_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hugging Face models scan failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as HFModel[];
}

function toRow(scanAt: Date, scanKind: string, model: HFModel) {
  const modelId = model.id ?? model.modelId ?? "";
  return {
    scan_at: chDateTime(scanAt),
    scan_kind: scanKind,
    model_id: modelId,
    author: model.author ?? modelId.split("/")[0] ?? "",
    pipeline_tag: model.pipeline_tag ?? "",
    library_name: model.library_name ?? "",
    tags: (model.tags ?? []).slice(0, 40),
    downloads: Math.max(0, Math.trunc(model.downloads ?? 0)),
    likes: Math.max(0, Math.trunc(model.likes ?? 0)),
    created_at: chDateTime(model.createdAt),
    last_modified: chDateTime(model.lastModified),
    is_private: model.private ? 1 : 0,
    is_gated: model.gated && model.gated !== "false" ? 1 : 0,
  };
}

export const ingestHuggingFaceModels = schedules.task({
  id: "ingest-huggingface-models",
  cron: "35 * * * *",
  maxDuration: 180,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    const scanAt = scanHour();
    const chunkKey = `models:${scanAt.toISOString().slice(0, 13)}`;
    const prior = await selectRows<{ c: string }>(
      `SELECT count() AS c FROM ingest_log WHERE source = 'huggingface' AND chunk_key = '${chunkKey}'`
    );
    if (Number(prior[0]?.c ?? 0) > 0) {
      metadata.set("ingest", { source: "huggingface", inserted: 0, skipped: true, chunkKey });
      logger.log("Hugging Face scan already recorded for hour", { chunkKey });
      return { inserted: 0, skipped: true, chunkKey };
    }

    const rows = [];
    for (const scan of SCANS) {
      const models = await fetchModels(scan.params);
      rows.push(...models.filter((model) => model.id || model.modelId).map((model) => toRow(scanAt, scan.kind, model)));
    }

    if (rows.length > 0) {
      await clickhouseInsert.insert({ table: "default.hf_model_snapshots", values: rows, format: "JSONEachRow" });
      await logIngest({ source: "huggingface", chunk_key: chunkKey, rows_ingested: rows.length });
    }

    metadata.set("ingest", { source: "huggingface", inserted: rows.length, chunkKey });
    logger.log("Ingested Hugging Face model snapshots", { chunkKey, rows: rows.length, scans: SCANS.length });
    return { inserted: rows.length, scans: SCANS.length, chunkKey };
  },
});
