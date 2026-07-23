/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";

describe("RenderedAnswer", () => {
  it("parses numeric values without reading the 30 out of field names", () => {
    const payload: RenderPayload = {
      type: "ticker",
      filter: "repos",
      generatedAt: "2026-07-23T08:00:00.000Z",
      items: [
        { kicker: "FORKED 24H", name: "alpha/repo", metric: "pushes_30d: 4", href: "https://example.com/alpha" },
        { kicker: "FORKED 24H", name: "beta/repo", metric: "pushes_30d: 9", href: "https://example.com/beta" },
      ],
    };

    const { container } = render(<RenderedAnswer payload={payload} />);
    const chart = container.querySelector("figure.chart svg");

    expect(chart).toBeInTheDocument();
    expect(chart?.textContent).toContain("4");
    expect(chart?.textContent).toContain("9");
    expect(chart?.textContent).not.toContain("30");
    expect(container.querySelectorAll("rect[fill='var(--cyan)']").length).toBeGreaterThan(0);
  });

  it("renders a table fallback and query analytics for morphing cards", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      summary: "Top forked skills repos",
      query: {
        sql: "SELECT repo, github_forks FROM example ORDER BY github_forks DESC LIMIT 8",
        rowsRead: 4321,
        elapsedMs: 87,
      },
      chartConfig: {
        title: 'Top forked "skills" repos',
        encoding: {
          x: { field: "repo", type: "nominal", sort: "-y" },
          y: { field: "github_forks", type: "quantitative", title: "GitHub forks" },
          tooltip: [
            { field: "repo", title: "Repo" },
            { field: "github_forks", title: "Forks" },
            { field: "github_stars", title: "Stars" },
            { field: "pushes_30d", title: "Pushes (30d)" },
          ],
        },
        data: {
          values: [
            { repo: "mattpocock/mattpocock/skills", github_forks: 15667, github_stars: 183203, pushes_30d: 0 },
            { repo: "coreyhaines31/coreyhaines31/marketingskills", github_forks: 6505, github_stars: 41221, pushes_30d: 4 },
          ],
        },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    render(<RenderedAnswer payload={payload} />);

    expect(screen.getByText('Top forked "skills" repos')).toBeInTheDocument();
    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("Forks")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("Pushes (30d)")).toBeInTheDocument();
    expect(screen.getByText("mattpocock/mattpocock/skills")).toBeInTheDocument();
    expect(screen.getByText(/previewing bar markup/i)).toBeInTheDocument();
    expect(screen.getByText(/4,321 rows read · 87ms/i)).toBeInTheDocument();
  });
});

describe("RenderedAnswer copy-as-HTML button", () => {
  const tickerPayload: RenderPayload = {
    type: "ticker",
    filter: "repos",
    generatedAt: "2026-07-23T08:00:00.000Z",
    items: [
      { kicker: "STARS", name: "alpha/repo", metric: "stars_24h: 42", href: "https://github.com/alpha/repo" },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("ClipboardItem", class {
      constructor(items: Record<string, Blob>) {
        Object.assign(this, items);
      }
    });
    vi.stubGlobal("navigator", {
      clipboard: {
        write: vi.fn(() => Promise.resolve()),
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Copy as Markdown and Copy as HTML buttons", () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    expect(screen.getAllByRole("button", { name: "Copy as Markdown" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Copy as HTML" }).length).toBeGreaterThan(0);
  });

  it("shows Copied MD! feedback after clicking Copy as Markdown", async () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as Markdown" });
    await act(() => fireEvent.click(btns[0]));
    expect(screen.getByText("Copied MD!")).toBeInTheDocument();
  });

  it("calls clipboard.write with a ClipboardItem containing text/html for HTML copy", async () => {
    const writeSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy, writeText: vi.fn(() => Promise.resolve()) },
    });
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as HTML" });
    await act(() => fireEvent.click(btns[0]));
    await waitFor(() => expect(writeSpy).toHaveBeenCalledTimes(1));
    const items = (writeSpy.mock.calls[0] as unknown[])[0] as unknown[];
    expect(items).toHaveLength(1);
  });

  it("reverts to Copy as Markdown label after 2 seconds", async () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as Markdown" });
    await act(() => fireEvent.click(btns[0]));
    expect(screen.getByText("Copied MD!")).toBeInTheDocument();
  });
});
