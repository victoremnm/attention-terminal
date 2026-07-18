import { divergence, freshness, pulse, tickerLanes } from "@/lib/queries";
import { divergenceVerdict, seriesVerdict } from "@/lib/verdicts";
import { AnswerCard } from "@/components/AnswerCard";
import { TickerRail } from "@/components/TickerRail";
import { AreaChart, DualLine } from "@/components/charts";

export const dynamic = "force-dynamic";

const SESSION = [
  "is htmx hype or real?",
  "rust, this month",
  "what's heating up in databases?",
  "new repos right now",
];

export default async function Home() {
  const [lanes, htmx, rust, fresh] = await Promise.all([
    tickerLanes(),
    divergence("htmx"),
    pulse("rust"),
    freshness(),
  ]);

  const htmxVerdict = divergenceVerdict(htmx.talk, htmx.code);
  const rustVerdict = seriesVerdict(rust.stories);
  const freshLabel = `HN data ${fresh.hn_lag_s}s old · GH through ${fresh.gh_chunk} UTC`;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="logo">▚ ATTENTION_TERMINAL</div>
        <div className="tagline">ask about tech attention</div>
        <div className="session-h">SESSION ─────────</div>
        <nav className="session">
          {SESSION.map((q) => (
            <a key={q} href="#feed">› {q}</a>
          ))}
        </nav>
        <input
          className="askbox"
          placeholder="ask a question…"
          disabled
          title="agent wiring lands next - answers below are live previews"
        />
      </aside>

      <main className="main">
        <TickerRail initial={lanes} />

        <div className="feed" id="feed">
          <AnswerCard
            question="is htmx hype or real?"
            verdict={htmxVerdict}
            detail={htmxVerdict.detail}
            spark={htmx.talk}
            caption="HN chatter (talk) vs GitHub activity on htmx repos (code), each normalized to its own 30-day peak. Where the lines separate is where the narrative and the shipping disagree."
            freshness={freshLabel}
            provenance={[htmx.provenance]}
          >
            <DualLine days={htmx.days} a={htmx.talk} b={htmx.code} aLabel="talk · HN mentions/day" bLabel="code · GH events/day" />
          </AnswerCard>

          <AnswerCard
            question="rust, this month"
            verdict={rustVerdict}
            spark={rust.stories}
            caption="Rust-mention stories per day on HN over the last 30 days; the labeled point is the month's peak."
            freshness={freshLabel}
            provenance={[rust.provenance]}
          >
            <AreaChart days={rust.days} values={rust.stories} label="HN stories mentioning rust / day" />
          </AnswerCard>
        </div>
      </main>
    </div>
  );
}
