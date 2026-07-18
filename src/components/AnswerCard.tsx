"use client";

import { useState, type ReactNode } from "react";
import type { Provenance } from "@/lib/queries";
import type { VerdictResult } from "@/lib/verdicts";
import { Sparkline } from "./charts";

const VERDICT_COLOR: Record<string, string> = {
  ACCELERATING: "var(--cyan)",
  PEAKING: "var(--amber)",
  COOLING: "var(--muted)",
  DORMANT: "var(--muted)",
  BREAKOUT: "var(--mag)",
  DIVERGENT: "var(--mag)",
};

export function VerdictTile({ verdict, spark, detail }: {
  verdict: VerdictResult; spark?: number[]; detail?: string;
}) {
  const color = VERDICT_COLOR[verdict.state];
  return (
    <div className="verdict" title={`threshold: ${verdict.rule}`}>
      <span className="verdict-state mono" style={{ color }}>{verdict.state}</span>
      <span className="verdict-metric mono">
        {verdict.metric}
        <em>{verdict.metricLabel}</em>
      </span>
      {spark && <Sparkline data={spark} color={color} />}
      {detail && <span className="verdict-detail">{detail}</span>}
    </div>
  );
}

export function AnswerCard({ question, verdict, spark, detail, caption, freshness, provenance, children }: {
  question: string;
  verdict: VerdictResult;
  spark?: number[];
  detail?: string;
  caption: string;
  freshness: string;
  provenance: Provenance[];
  children: ReactNode;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <article className="answer">
      <div className="answer-q mono">› {question}</div>
      {!flipped ? (
        <>
          <VerdictTile verdict={verdict} spark={spark} detail={detail} />
          {children}
          <p className="caption">{caption}</p>
          <div className="context-strip mono">
            <span>{freshness}</span>
            <button className="chip" onClick={() => setFlipped(true)}>⟲ view SQL</button>
          </div>
        </>
      ) : (
        <div className="card-back">
          <div className="back-head mono">⟲ QUERY · {question}</div>
          {provenance.map((p, i) => (
            <div key={i} className="back-query">
              <pre className="mono">{p.sql}</pre>
              <div className="back-meta mono">
                <span>tables: {p.tables.join(", ")}</span>
                {p.rowsRead !== undefined && <span>rows read: {p.rowsRead.toLocaleString()}</span>}
                <span>query: {p.elapsedMs}ms</span>
              </div>
            </div>
          ))}
          <div className="context-strip mono">
            <span>{freshness}</span>
            <button className="chip" onClick={() => setFlipped(false)}>⟲ back to answer</button>
          </div>
        </div>
      )}
    </article>
  );
}
