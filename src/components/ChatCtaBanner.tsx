import Link from "next/link";

const asideStyle: React.CSSProperties = {
  margin: "24px 0",
  padding: "16px",
  borderRadius: "8px",
  background: "var(--panel)",
  border: "1px solid var(--line)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const linkStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: "0.75rem",
  fontWeight: 600,
  borderRadius: "4px",
  color: "var(--cyan)",
  background: "rgba(0, 200, 240, 0.08)",
  border: "1px solid rgba(56, 205, 236, 0.3)",
  display: "flex",
  alignItems: "center",
  gap: "6px",
  whiteSpace: "nowrap",
  textDecoration: "none",
  transition: "0.2s",
};

export function ChatCtaBanner() {
  return (
    <aside className="chat-cta-banner" style={asideStyle}>
      <div style={rowStyle}>
        <span style={{ fontSize: "1.25rem" }}>💬</span>
        <div>
          <h4 className="mono" style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--ink)" }}>
            ATTENTION AGENT READY
          </h4>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
            Ask questions, request deep queries, or explore repository insights.
          </p>
        </div>
      </div>
      <Link
        href="/chat"
        className="chat-cta-link mono"
        style={linkStyle}
      >
        Open Terminal Chat →
      </Link>
    </aside>
  );
}
