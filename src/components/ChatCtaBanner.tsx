import Link from "next/link";

export function ChatCtaBanner() {
  return (
    <aside className="chat-cta-banner my-6 p-4 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-xl">💬</span>
        <div>
          <h4 className="text-sm font-semibold text-slate-200 mono">ATTENTION AGENT READY</h4>
          <p className="text-xs text-slate-400">Ask questions, request deep queries, or explore repository insights.</p>
        </div>
      </div>
      <Link
        href="/chat"
        className="px-4 py-2 text-xs font-semibold mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 hover:bg-cyan-900/50 hover:border-cyan-400 rounded transition-all flex items-center gap-1.5 whitespace-nowrap"
      >
        Open Terminal Chat →
      </Link>
    </aside>
  );
}
