import Link from "next/link";

export function ChatCtaBanner() {
  return (
    <aside className="chat-cta-banner" aria-label="Attention Terminal chat">
      <div className="chat-cta-content">
        <span className="chat-cta-icon" aria-hidden="true">💬</span>
        <div className="chat-cta-copy">
          <h2 className="chat-cta-title mono">ATTENTION AGENT READY</h2>
          <p>Ask questions, request deep queries, or explore repository insights.</p>
        </div>
      </div>
      <Link
        href="/chat"
        className="chat-cta-link chip"
      >
        Open Terminal Chat <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}
