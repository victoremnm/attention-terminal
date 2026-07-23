"use client";

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

const allowedTags = new Set(purifyConfig.ALLOWED_TAGS);
const allowedAttrs = new Set(purifyConfig.ALLOWED_ATTR);

function sanitizeElement(element: Element) {
  const tagName = element.tagName.toLowerCase();

  if (!allowedTags.has(tagName)) {
    const replacement = document.createDocumentFragment();
    while (element.firstChild) {
      const child = element.firstChild;
      element.removeChild(child);
      if (child instanceof Element) {
        sanitizeElement(child);
      }
      replacement.appendChild(child);
    }
    element.replaceWith(replacement);
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    if (!allowedAttrs.has(attr.name)) {
      element.removeAttribute(attr.name);
    }
  }

  if (tagName === "a") {
    const href = element.getAttribute("href") ?? "";
    const allowedProtocol = /^(https?:|\/)/i.test(href);
    if (!allowedProtocol) {
      element.removeAttribute("href");
      element.setAttribute("role", "button");
      element.setAttribute("aria-disabled", "true");
    } else {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  for (const child of Array.from(element.children)) {
    sanitizeElement(child);
  }
}

function sanitizeHtml(raw: string) {
  const template = document.createElement("template");
  template.innerHTML = raw;

  for (const child of Array.from(template.content.children)) {
    sanitizeElement(child);
  }

  return template.innerHTML;
}

export interface MarkdownTextProps {
  text: string;
  streaming?: boolean;
}

export function MarkdownText({ text, streaming }: MarkdownTextProps) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    return sanitizeHtml(raw);
  }, [text]);

  return (
    <div
      className={`markdown-text${streaming ? " markdown-text-streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
