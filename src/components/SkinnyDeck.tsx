"use client";

// The tactile Daily Skinny deck (issue #27, design spec AGENT-FLEET-PLAN.md §4.4).
// This is the ONLY place motion physics live in the app: drag + spring on the card,
// a spring flip to view-SQL, and a draggable Material-3-style discussion sheet.
// Everything else in the product stays motion-sparse (instant swaps, no entrance fx).

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useAnimation, type PanInfo } from "framer-motion";
import type { SkinnyCard, SkinnyDeckPayload, SkinnyVisual } from "@/lib/render-payload";
import { VERDICT_COLOR } from "@/lib/verdict-color";
import { AreaChart, DevScatterChart, DualLine } from "./charts";

type Decision = "pin" | "skip";
type ExitState = { decision: Decision } | null;

const SWIPE_DISTANCE = 120;
const SWIPE_VELOCITY = 480;

function CardVisual({ visual }: { visual: SkinnyVisual }) {
  if (visual.kind === "dev-scatter") {
    return <DevScatterChart points={visual.points} note={visual.note} />;
  }
  if (visual.kind === "divergence") {
    return <DualLine days={visual.days} a={visual.talk} b={visual.code} aLabel="talk · HN" bLabel="code · GH" />;
  }
  return <AreaChart days={visual.days} values={visual.values} label="7-day trend" />;
}

function CardFront({ card, onFlip }: { card: SkinnyCard; onFlip: () => void }) {
  return (
    <>
      <header className="deck-card-head">
        <span className="deck-verdict mono" style={{ color: VERDICT_COLOR[card.verdict] }}>
          {card.verdict}
        </span>
        <button type="button" className="deck-sql-btn mono" onClick={onFlip}>
          ↺ view sql
        </button>
      </header>
      <div className="deck-face-scroll">
        <h2 className="deck-subject">{card.subject}</h2>
        <div className="deck-metric mono">
          <b>{card.metric}</b>
          <span>{card.metricLabel}</span>
        </div>
        <div className="deck-visual">
          <CardVisual visual={card.visual} />
        </div>
        <p className="deck-caption">{card.caption}</p>
        <div className="deck-sources mono">{card.sources}</div>
      </div>
    </>
  );
}

function CardBack({ card, onFlipBack }: { card: SkinnyCard; onFlipBack: () => void }) {
  return (
    <>
      <header className="deck-card-head">
        <span className="mono deck-back-kicker">VIEW SQL</span>
        <button type="button" className="deck-sql-btn mono" onClick={onFlipBack}>
          ↺ back to card
        </button>
      </header>
      <div className="deck-face-scroll">
        <div className="back-query">
          <pre className="mono">{card.query.sql}</pre>
        </div>
      </div>
      <div className="back-meta mono">
        <span>{card.query.rowsRead.toLocaleString()} rows read</span>
        <span>{card.query.elapsedMs.toLocaleString()} ms</span>
      </div>
    </>
  );
}

function DiscussionSheet({
  comment,
  commentsCount,
  hnThreadUrl,
  expanded,
  onExpandedChange,
}: {
  comment: NonNullable<SkinnyCard["topComment"]>;
  commentsCount?: number;
  hnThreadUrl?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const PEEK = 46;
  const EXPANDED = 190;
  const travel = EXPANDED - PEEK;

  function handleDragEnd(_event: unknown, info: PanInfo) {
    const shouldExpand = info.offset.y < -travel / 3 || info.velocity.y < -400;
    onExpandedChange(shouldExpand);
  }

  return (
    <motion.div
      className="deck-sheet"
      style={{ height: EXPANDED }}
      drag="y"
      dragConstraints={{ top: 0, bottom: travel }}
      dragElastic={0.15}
      animate={{ y: expanded ? 0 : travel }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      onDragEnd={handleDragEnd}
    >
      <button
        type="button"
        className="deck-sheet-handle"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
      >
        <i className="deck-sheet-grip" aria-hidden="true" />
        <span className="mono">{commentsCount ?? 0} comments · top take</span>
      </button>
      <div className="deck-sheet-body">
        <p className="deck-sheet-comment">&ldquo;{comment.body}&rdquo;</p>
        <span className="mono deck-sheet-meta">
          {comment.author} · {comment.pts} pts · {comment.ago}
        </span>
        {hnThreadUrl && (
          <a href={hnThreadUrl} target="_blank" rel="noreferrer" className="mono deck-sheet-link">
            open thread ↗
          </a>
        )}
      </div>
    </motion.div>
  );
}

function DeckCard({
  card,
  exit,
  onDecide,
  onExitComplete,
}: {
  card: SkinnyCard;
  exit: ExitState;
  onDecide: (decision: Decision) => void;
  onExitComplete: () => void;
}) {
  const controls = useAnimation();
  const [flipped, setFlipped] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Mount: pop the fresh card into place.
  useEffect(() => {
    controls.start({
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      rotate: 0,
      transition: { type: "spring", stiffness: 340, damping: 30 },
    });
    // Runs once per mount — this component remounts per card via a stable `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit: driven imperatively so the parent only advances the deck once the
  // spring has actually finished (avoids racing AnimatePresence's exit props
  // against this component's own local flip/sheet state).
  useEffect(() => {
    if (!exit) return;
    let alive = true;
    const target =
      exit.decision === "pin"
        ? { x: 520, rotate: 14, opacity: 0 }
        : { x: -520, rotate: -14, opacity: 0 };
    controls.start({ ...target, transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } }).then(() => {
      if (alive) onExitComplete();
    });
    return () => {
      alive = false;
    };
  }, [exit, controls, onExitComplete]);

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (exit || flipped) return;
    if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) {
      onDecide("pin");
    } else if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) {
      onDecide("skip");
    } else {
      controls.start({ x: 0, rotate: 0, transition: { type: "spring", stiffness: 420, damping: 34 } });
    }
  }

  return (
    <motion.div
      className="deck-card"
      role="group"
      aria-label={`${card.subject} — swipe left to skip, right to pin`}
      initial={{ scale: 0.95, opacity: 0, y: 10 }}
      animate={controls}
      drag={!flipped ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      whileDrag={{ scale: 1.02 }}
      onDragEnd={handleDragEnd}
    >
      <motion.div
        className="deck-card-flipper"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="deck-face deck-face-front">
          <CardFront card={card} onFlip={() => setFlipped(true)} />
          {card.topComment && (
            <DiscussionSheet
              comment={card.topComment}
              commentsCount={card.commentsCount}
              hnThreadUrl={card.hnThreadUrl}
              expanded={sheetExpanded}
              onExpandedChange={setSheetExpanded}
            />
          )}
        </div>
        <div className="deck-face deck-face-back">
          <CardBack card={card} onFlipBack={() => setFlipped(false)} />
        </div>
      </motion.div>

      {!flipped && (
        <div className="deck-actions">
          <button type="button" className="deck-btn deck-btn-skip mono" disabled={!!exit} onClick={() => onDecide("skip")}>
            <span aria-hidden="true">✕</span> skip
          </button>
          <button type="button" className="deck-btn deck-btn-pin mono" disabled={!!exit} onClick={() => onDecide("pin")}>
            <span aria-hidden="true">★</span> pin
          </button>
        </div>
      )}
    </motion.div>
  );
}

function SessionComplete({ total, pinned }: { total: number; pinned: SkinnyCard[] }) {
  return (
    <div className="deck-complete">
      <p className="mono deck-complete-kicker">SESSION COMPLETE</p>
      <h2 className="deck-complete-title">the feed does not refill</h2>
      <p className="deck-complete-sub">the terminal closes.</p>
      <div className="deck-complete-stats mono">
        <span>
          <b>{total}</b> read
        </span>
        <span>
          <b>{pinned.length}</b> pinned
        </span>
      </div>
      {pinned.length > 0 && (
        <ul className="deck-complete-pins">
          {pinned.map((card) => (
            <li key={card.id}>
              <span className="mono" style={{ color: VERDICT_COLOR[card.verdict] }}>
                {card.verdict}
              </span>
              {card.subject}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SkinnyDeck({ payload }: { payload: SkinnyDeckPayload }) {
  const [resolved, setResolved] = useState<Array<{ card: SkinnyCard; decision: Decision }>>([]);
  const [exiting, setExiting] = useState<ExitState>(null);

  const currentIndex = resolved.length;
  const current = payload.cards[currentIndex];
  const done = currentIndex >= payload.cards.length;

  const handleDecide = useCallback((decision: Decision) => {
    setExiting((prev) => prev ?? { decision });
  }, []);

  const handleExitComplete = useCallback(() => {
    setResolved((prev) => {
      const card = payload.cards[prev.length];
      if (!card) return prev;
      return [...prev, { card, decision: exiting?.decision ?? "skip" }];
    });
    setExiting(null);
  }, [exiting, payload.cards]);

  return (
    <div className="deck-shell">
      <div className="deck-header mono">
        <span>THE DAILY SKINNY · {payload.dateStr}</span>
        <span className="muted">{done ? "session complete" : `${currentIndex + 1} / ${payload.cards.length}`}</span>
      </div>
      <div className="deck-stage">
        <AnimatePresence mode="popLayout">
          {done ? (
            <motion.div key="complete" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <SessionComplete
                total={resolved.length}
                pinned={resolved.filter((r) => r.decision === "pin").map((r) => r.card)}
              />
            </motion.div>
          ) : (
            current && (
              <DeckCard
                key={current.id}
                card={current}
                exit={exiting}
                onDecide={handleDecide}
                onExitComplete={handleExitComplete}
              />
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
