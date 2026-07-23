// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const realtimeMock = vi.hoisted(() => ({
  useRealtimeRunsWithTag: vi.fn(),
}));

vi.mock("@trigger.dev/react-hooks", () => ({
  useRealtimeRunsWithTag: realtimeMock.useRealtimeRunsWithTag,
}));

import { useIngestPulse } from "./useIngestPulse";

describe("useIngestPulse", () => {
  beforeEach(() => {
    realtimeMock.useRealtimeRunsWithTag.mockReset();
  });

  it("requests a trimmed realtime payload when a token is present", () => {
    realtimeMock.useRealtimeRunsWithTag.mockReturnValue({ runs: [], error: undefined });

    renderHook(() => useIngestPulse("public-token"));

    expect(realtimeMock.useRealtimeRunsWithTag).toHaveBeenCalledWith(
      "ingest",
      expect.objectContaining({
        accessToken: "public-token",
        enabled: true,
        skipColumns: expect.arrayContaining(["payload", "output", "runTags", "error"]),
      })
    );
  });

  it("turns realtime off after the first subscription error", async () => {
    realtimeMock.useRealtimeRunsWithTag.mockReturnValue({ runs: [], error: new Error("boom") });

    renderHook(() => useIngestPulse("public-token"));

    await waitFor(() => {
      expect(realtimeMock.useRealtimeRunsWithTag).toHaveBeenLastCalledWith(
        "ingest",
        expect.objectContaining({
          accessToken: "public-token",
          enabled: false,
        })
      );
    });
  });
});
