"use client";

import { useEffect, useMemo, useState } from "react";
import type { RealtimeRunSkipColumns } from "@trigger.dev/core/v3";
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";
import type { ingestHackernews } from "@/trigger/ingest-hackernews";
import type { ingestGhArchive } from "@/trigger/ingest-gharchive";
import type { ingestHuggingFaceModels } from "@/trigger/ingest-huggingface";

type IngestTask = typeof ingestHackernews | typeof ingestGhArchive | typeof ingestHuggingFaceModels;

export interface IngestMeta {
  source: string;
  inserted?: number;
  filesLoaded?: number;
}

const INGEST_SKIP_COLUMNS: RealtimeRunSkipColumns = [
  "payload",
  "output",
  "startedAt",
  "delayUntil",
  "queuedAt",
  "expiredAt",
  "number",
  "isTest",
  "usageDurationMs",
  "costInCents",
  "baseCostInCents",
  "ttl",
  "payloadType",
  "outputType",
  "runTags",
  "error",
];

// Subscribes to all ingestion runs (tag "ingest") over Trigger.dev Realtime.
// Returns the moment fresh data last landed and what landed, so components
// can tick without polling.
export function useIngestPulse(accessToken?: string) {
  const [realtimeEnabled, setRealtimeEnabled] = useState(Boolean(accessToken));

  useEffect(() => {
    setRealtimeEnabled(Boolean(accessToken));
  }, [accessToken]);

  const realtimeOptions = useMemo(() => {
    return {
      accessToken: accessToken ?? "",
      enabled: Boolean(accessToken) && realtimeEnabled,
      skipColumns: INGEST_SKIP_COLUMNS,
      ...(process.env.NEXT_PUBLIC_TRIGGER_API_URL
        ? { baseURL: process.env.NEXT_PUBLIC_TRIGGER_API_URL }
        : {}),
    };
  }, [accessToken, realtimeEnabled]);

  const { runs, error } = useRealtimeRunsWithTag<IngestTask>("ingest", realtimeOptions);

  useEffect(() => {
    if (error) setRealtimeEnabled(false);
  }, [error]);

  let lastIngestAt: Date | null = null;
  let lastIngest: IngestMeta | null = null;
  for (const run of runs) {
    if (run.status !== "COMPLETED" || !run.finishedAt) continue;
    const finishedAt = new Date(run.finishedAt);
    if (lastIngestAt && finishedAt <= lastIngestAt) continue;
    lastIngestAt = finishedAt;
    lastIngest = (run.metadata?.ingest as IngestMeta | undefined) ?? null;
  }

  const isIngesting = runs.some((run) => run.status === "EXECUTING");

  return { lastIngestAt, lastIngest, isIngesting, error };
}
