"use client";

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { useMemo } from "react";

marked.use({ gfm: true });

const purifyConfig = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "del",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "a",
    "code",
    "pre",
    "blockquote",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  KEEP_CONTENT: true,
};

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    const allowedProtocol = /^(https?:|\/)/i.test(href);
    if (!allowedProtocol) {
      node.removeAttribute("href");
      node.setAttribute("role", "button");
      node.setAttribute("aria-disabled", "true");
    } else {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

export interface MarkdownTextProps {
  text: string;
  streaming?: boolean;
}

export function MarkdownText({ text, streaming }: MarkdownTextProps) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw, purifyConfig);
  }, [text]);

  return (
    <div
      className={`markdown-text${streaming ? " markdown-text-streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
