/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownText } from "./MarkdownText";

describe("MarkdownText", () => {
  it("renders plain text", () => {
    render(<MarkdownText text="hello world" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders headings and emphasis", () => {
    const { container } = render(<MarkdownText text={"# Title\n**bold** and *italic*"} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders lists", () => {
    const { container } = render(<MarkdownText text={"- one\n- two\n\n1. first\n2. second"} />);
    expect(container.querySelectorAll("ul li").length).toBe(2);
    expect(container.querySelectorAll("ol li").length).toBe(2);
  });

  it("renders inline code", () => {
    const { container } = render(<MarkdownText text="use `code`" />);
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders fenced code blocks", () => {
    const text = ["```ts", "const x = 1;", "```"].join("\n");
    const { container } = render(<MarkdownText text={text} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toContain("const x = 1;");
  });

  it("renders tables", () => {
    const { container } = render(
      <MarkdownText text={"| a | b |\n|---|---|\n| 1 | 2 |"} />
    );
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("renders safe links with target and rel", () => {
    const { container } = render(<MarkdownText text="[link](https://example.com)" />);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("disables unsafe javascript links", () => {
    const { container } = render(<MarkdownText text="[bad](javascript:alert(1))" />);
    const anchor = container.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables data URIs", () => {
    const { container } = render(<MarkdownText text="[bad](data:text/html,foo)" />);
    const anchor = container.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
  });

  it("strips raw HTML and scripts", () => {
    const { container } = render(
      <MarkdownText text="<script>alert(1)</script><p>safe</p>" />
    );
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.textContent).toContain("safe");
  });

  it("survives malformed markdown", () => {
    const { container } = render(<MarkdownText text="**unclosed" />);
    expect(container.textContent).toContain("unclosed");
  });
});
