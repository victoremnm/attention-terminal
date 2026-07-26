import { describe, expect, it, vi } from "vitest";

const { qMock } = vi.hoisted(() => ({ qMock: vi.fn() }));
vi.mock("./core", () => ({ q: qMock }));

import {
  eventTimelineFeed,
  eventTypeHourlyAggregation,
  eventTypeTotals,
  eventVolumeByDay,
  eventVolumeFeed,
  firehoseRepoSignal,
  firehoseEventMix,
  firehoseEventMixDaily,
  firehoseEventMixMonthly,
  firehoseStats,
} from "./firehose";

describe("firehose query dependencies", () => {
  const queries: Array<[string, () => Promise<unknown>, string[]]> = [
    ["event volume", eventVolumeFeed, ["curated.event_volume_hourly"]],
    ["event timeline", eventTimelineFeed, ["curated.event_timeline"]],
    ["event volume by day", () => eventVolumeByDay("owner/repo"), ["curated.event_volume_daily"]],
    ["firehose stats", firehoseStats, ["curated.event_volume_hourly"]],
    ["repo signal", firehoseRepoSignal, ["curated.firehose_repo_signal_hourly"]],
    ["event mix", firehoseEventMix, ["curated.firehose_event_type_action_hourly"]],
    ["daily event mix", firehoseEventMixDaily, ["curated.firehose_event_type_action_daily"]],
    ["monthly event mix", firehoseEventMixMonthly, ["curated.firehose_event_type_action_monthly"]],
    ["event type hourly agg", eventTypeHourlyAggregation, ["curated.firehose_event_type_action_hourly"]],
    ["event type totals", eventTypeTotals, ["curated.firehose_event_type_action_hourly"]],
  ];

  it.each(queries)("checks only the %s table", async (_name, query, expectedTables) => {
    qMock.mockResolvedValueOnce({ rows: [], provenance: { sql: "SELECT 1", elapsedMs: 0 } });
    await query();
    expect(qMock.mock.calls.at(-1)?.[1]).toEqual(expectedTables);
  });
});
