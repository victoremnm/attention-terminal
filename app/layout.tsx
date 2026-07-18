import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attention Terminal",
  description:
    "Ask about tech attention - answers are live visuals over HackerNews + GitHub data. ClickHouse x Trigger.dev Hackathon 2026.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
