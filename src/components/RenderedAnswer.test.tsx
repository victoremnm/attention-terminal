/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";

afterEach(() => cleanup());

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

describe("RenderedAnswer table payload", () => {
  const tablePayload: RenderPayload = {
    type: "table",
    columns: [
      { key: "repo", label: "Repository", type: "string" },
      { key: "stars", label: "Stars", type: "number" },
      { key: "url", label: "URL", type: "link" },
    ],
    rows: [
      { repo: "acme/widgets", stars: 1500, url: "https://github.com/acme/widgets" },
      { repo: "acme/tools", stars: 800, url: "https://github.com/acme/tools" },
    ],
    totals: { stars: 2300 },
    summary: "Top ACME repos",
  };

  it("renders column headers from table payload", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("renders table cell values", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });

  it("renders link columns as anchor tags", () => {
    const { container } = render(<RenderedAnswer payload={tablePayload} />);
    const links = container.querySelectorAll("a[href='https://github.com/acme/widgets']");
    expect(links.length).toBeGreaterThan(0);
  });

  it("renders totals row", () => {
    const { container } = render(<RenderedAnswer payload={tablePayload} />);
    const tfoot = container.querySelector("tfoot");
    expect(tfoot).toBeInTheDocument();
    expect(tfoot?.textContent).toContain("Total");
    expect(tfoot?.textContent).toContain("2,300");
  });

  it("renders summary when provided", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("Top ACME repos")).toBeInTheDocument();
  });

  it("shows column count and row count in header", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText(/3 columns/)).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
  });

  it("shows empty state when rows array is empty", () => {
    const empty: RenderPayload = {
      type: "table",
      columns: [{ key: "col", label: "Column", type: "string" }],
      rows: [],
    };
    render(<RenderedAnswer payload={empty} />);
    expect(screen.getByText("no rows returned")).toBeInTheDocument();
  });

  it("limits displayed rows to 20 and shows count note for larger datasets", () => {
    const manyRows = Array.from({ length: 25 }, (_, i) => ({ col: `row ${i + 1}` }));
    const big: RenderPayload = {
      type: "table",
      columns: [{ key: "col", label: "Col", type: "string" }],
      rows: manyRows,
    };
    const { container } = render(<RenderedAnswer payload={big} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(20);
    expect(screen.getByText(/showing 20 of 25/)).toBeInTheDocument();
  });

  it("renders Data Table morphing-card without previewing message", () => {
    const dtPayload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Data Table",
      generatedAt: "2026-07-23T08:27:40.000Z",
      summary: "Repo list",
      chartConfig: {
        data: {
          values: [
            { repo: "acme/widgets", stars: 1500 },
          ],
        },
        encoding: {
          tooltip: [
            { field: "repo", title: "Repo" },
            { field: "stars", title: "Stars" },
          ],
        },
      },
    };
    render(<RenderedAnswer payload={dtPayload} />);
    expect(screen.getByText("DATA TABLE")).toBeInTheDocument();
    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.queryByText(/previewing/)).not.toBeInTheDocument();
  });
});
