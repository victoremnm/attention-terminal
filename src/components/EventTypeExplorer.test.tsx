/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventTypeExplorer } from "./EventTypeExplorer";
import type { EventTypeHourlyRow } from "@/lib/queries";

const mockData: EventTypeHourlyRow[] = [
  { hour_bucket: "2026-07-26 08:00:00", event_type: "PushEvent", event_count: "150", actor_count: "20" },
  { hour_bucket: "2026-07-26 08:00:00", event_type: "WatchEvent", event_count: "80", actor_count: "15" },
  { hour_bucket: "2026-07-26 09:00:00", event_type: "PushEvent", event_count: "200", actor_count: "25" },
  { hour_bucket: "2026-07-26 09:00:00", event_type: "WatchEvent", event_count: "60", actor_count: "12" },
  { hour_bucket: "2026-07-26 09:00:00", event_type: "ForkEvent", event_count: "30", actor_count: "8" },
];

afterEach(() => {
  cleanup();
});

describe("EventTypeExplorer", () => {
  it("renders empty state when no data", () => {
    render(<EventTypeExplorer hourlyData={[]} />);
    expect(screen.getByText("No event type data available yet.")).toBeInTheDocument();
  });

  it("renders chart and legend from data", () => {
    render(<EventTypeExplorer hourlyData={mockData} />);
    expect(screen.getByLabelText("Event type distribution chart")).toBeInTheDocument();
    const legendItems = screen.getAllByRole("button", { name: /add to filter/ });
    expect(legendItems).toHaveLength(3);
  });

  it("shows accessible data table on request", async () => {
    render(<EventTypeExplorer hourlyData={mockData} />);
    const toggle = screen.getByText("View hourly data table");
    await act(async () => { toggle.click(); });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });

  it("calls onFilterChange with selected types on Apply", async () => {
    const onFilterChange = vi.fn();
    render(<EventTypeExplorer hourlyData={mockData} onFilterChange={onFilterChange} />);

    const pushBtn = screen.getByLabelText("PushEvent — click to add to filter");
    await act(async () => { pushBtn.click(); });

    const applyBtn = screen.getByText("Apply filter (1)");
    await act(async () => { applyBtn.click(); });

    expect(onFilterChange).toHaveBeenCalledWith(["PushEvent"]);
  });

  it("shows active filters badge when types are selected externally", () => {
    render(<EventTypeExplorer hourlyData={mockData} activeEventTypes={["PushEvent"]} />);
    expect(screen.getByText(/Filtering by: Push/)).toBeInTheDocument();
  });

  it("can clear filters via Clear button", async () => {
    const onFilterChange = vi.fn();
    render(<EventTypeExplorer hourlyData={mockData} onFilterChange={onFilterChange} />);

    const pushBtn = screen.getByLabelText("PushEvent — click to add to filter");
    await act(async () => { pushBtn.click(); });

    const clearBtn = screen.getByText("Clear");
    await act(async () => { clearBtn.click(); });

    expect(onFilterChange).toHaveBeenCalledWith([]);
  });

  it("disables apply when no types selected", () => {
    render(<EventTypeExplorer hourlyData={mockData} />);
    expect(screen.getByText("Apply filter (0)")).toBeDisabled();
  });
});
