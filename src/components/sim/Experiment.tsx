import type { Stats, ExperimentResult } from '@/render/scene';
import { EXPERIMENT_DURATIONS } from '@/render/scene';
import { CARD } from './ui';
import { IconArrow, IconFlask } from './icons';

const SECONDARY: { label: string; get: (s: Stats) => number; fmt: (n: number) => string; better: 'up' | 'down' }[] = [
  { label: 'Avg speed', get: (s) => s.avgSpeedKmh, fmt: (n) => `${Math.round(n)} km/h`, better: 'up' },
  { label: 'Avg trip time', get: (s) => s.avgTravelTime, fmt: (n) => (n ? `${Math.round(n)} s` : '—'), better: 'down' },
];

const mins = (ticks: number) => `${Math.round(ticks / 300)} min`;
const rel = (a: number, b: number) => (a ? (b - a) / Math.abs(a) : 0);

// A verdict only reads as a win/loss when the throughput move is material — both
// a few trips AND a few percent. A ±1-trip swing over a short run is within the
// margin, so it stays neutral instead of being trumpeted as an "Improvement".
const MIN_REL = 0.02;
const MIN_TRIPS = 2;

function summarize(result: ExperimentResult) {
  const tripsA = result.baseline.completedTrips;
  const tripsB = result.intervention.completedTrips;
  const dTrips = tripsB - tripsA;
  const tripsRel = rel(tripsA, tripsB);
  const speedRel = rel(result.baseline.avgSpeedKmh, result.intervention.avgSpeedKmh);
  const material = Math.abs(dTrips) >= MIN_TRIPS && Math.abs(tripsRel) >= MIN_REL;
  const up = material && dTrips > 0;
  const down = material && dTrips < 0;
  const verdict = up
    ? { mark: '✓', label: 'Improvement', tone: 'var(--good)' }
    : down
      ? { mark: '✗', label: 'Regression', tone: 'var(--bad)' }
      : { mark: '≈', label: dTrips === 0 ? 'No change' : 'Negligible', tone: 'var(--text-3)' };

  const tradeoff = up && speedRel < -0.01;
  const pct = `${tripsRel > 0.0005 ? '+' : ''}${Math.round(tripsRel * 100)}%`;
  return { tripsA, tripsB, verdict, tradeoff, pct, marginal: !material && dTrips !== 0 };
}

export function Experiment({
  result,
  running,
  duration,
  onDuration,
  onRun,
  onClearStaged,
  hasIntervention,
  highlight,
}: {
  result: ExperimentResult | null;
  running: boolean;
  duration: number;
  onDuration: (ticks: number) => void;
  onRun: () => void;
  onClearStaged: () => void;
  hasIntervention: boolean;
  highlight: boolean;
}) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconFlask />
        <div className="eyebrow">Controlled experiment · A/B</div>
      </div>

      <div className="eyebrow mb-1.5">Simulation time</div>
      <div className="mb-2 flex rounded-lg bg-(--surface-3) p-0.5">
        {EXPERIMENT_DURATIONS.map((t) => (
          <button
            key={t}
            onClick={() => onDuration(t)}
            className={`tnum flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors ${
              duration === t
                ? 'bg-(--surface-1) text-(--text-1) ring-1 ring-(--border)'
                : 'text-(--text-3) hover:text-(--text-2)'
            }`}
          >
            {mins(t)}
          </button>
        ))}
      </div>

      <button
        onClick={onRun}
        disabled={running || !hasIntervention}
        className={`w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          running ? 'bg-(--surface-2) text-(--text-2)' : 'bg-(--accent) text-white hover:brightness-110'
        } ${highlight ? 'hint-ring' : ''}`}
      >
        {running ? 'Running…' : result ? 'Run again' : 'Run experiment'}
      </button>

      {hasIntervention && (
        <button
          onClick={onClearStaged}
          title="Revert every staged change back to the untouched network"
          className="mt-2 w-full text-[11.5px] font-medium text-(--text-3) transition-colors hover:text-(--text-1)"
        >
          Clear staged changes
        </button>
      )}

      {!hasIntervention && !result && (
        <p className="mt-3 text-[12px] leading-relaxed text-(--text-3)">
          Stage a change — close a road, add a signal, or flip priority — then run it. The A/B pits the
          <strong className="text-(--text-2)"> untouched network</strong> against
          <strong className="text-(--text-2)"> everything you&apos;ve staged</strong>, from the same seed
          for the same {mins(duration)}. Changes stack — use <em>Clear staged</em> to test one at a time.
        </p>
      )}

      {result && (() => {
        const s = summarize(result);
        return (
          <div className="mt-3">
            {/* Verdict + hero: the one number the user came for. */}
            <div className="rounded-xl bg-(--surface-2) p-3.5 ring-1 ring-(--border)">
              <div className="flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: s.verdict.tone }}>
                <span aria-hidden>{s.verdict.mark}</span>
                {s.verdict.label}
              </div>
              <div className="mt-2 flex items-baseline gap-2.5">
                <span className="tnum text-[34px] font-bold leading-none tracking-tight" style={{ color: s.verdict.tone }}>
                  {s.pct}
                </span>
                <div className="leading-tight">
                  <div className="eyebrow">Trips completed</div>
                  <div className="tnum text-[13px] font-semibold text-(--text-2)">{s.tripsA} → {s.tripsB}</div>
                </div>
              </div>
              {s.tradeoff && (
                <div className="mt-3 flex items-center gap-2.5 border-t border-(--border) pt-2.5 text-[11px] font-semibold">
                  <span className="eyebrow">Trade-off</span>
                  <span className="text-(--good)">↑ throughput</span>
                  <span className="text-(--bad)">↓ avg speed</span>
                </div>
              )}
              {s.marginal && (
                <div className="mt-2.5 border-t border-(--border) pt-2 text-[11px] leading-snug text-(--text-3)">
                  Within the margin of a short run — try 5 min for a clearer signal.
                </div>
              )}
            </div>

            <div className="mt-3 mb-2 flex flex-wrap items-center gap-1.5">
              <span className="eyebrow">Baseline → change</span>
              {result.changes.map((c) => (
                <span
                  key={c}
                  className="tnum rounded-md bg-(--surface-3) px-2 py-0.5 text-[10px] font-semibold text-(--text-2)"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {SECONDARY.map((m) => {
                const a = m.get(result.baseline);
                const b = m.get(result.intervention);
                return (
                  <ImpactRow key={m.label} label={m.label} a={m.fmt(a)} b={m.fmt(b)} delta={b - a} better={m.better} rel={a ? (b - a) / Math.abs(a) : 0} />
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-(--text-3)">
              Both ran from the same seed for {mins(result.durationTicks)} — the delta is your change, not
              time or noise.
            </p>
          </div>
        );
      })()}
    </section>
  );
}

function ImpactRow({
  label,
  a,
  b,
  delta,
  better,
  rel,
}: {
  label: string;
  a: string;
  b: string;
  delta: number;
  better: 'up' | 'down';
  rel: number;
}) {
  const improved = Math.abs(delta) < 1e-6 ? null : (delta > 0) === (better === 'up');
  const tone = improved === null ? 'var(--text-3)' : improved ? 'var(--good)' : 'var(--bad)';
  const pct = Math.max(-1, Math.min(1, rel));
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-(--text-2)">{label}</span>
        <div className="flex items-center gap-2">
          <span className="tnum text-[12px] text-(--text-3)">{a}</span>
          <IconArrow />
          <span className="tnum text-[12.5px] font-semibold text-(--text-1)">{b}</span>
          <span className="tnum w-14 text-right text-[11px] font-semibold" style={{ color: tone }}>
            {improved === null ? '±0' : `${delta > 0 ? '+' : ''}${(rel * 100).toFixed(0)}%`}
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-(--surface-3)">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.abs(pct) * 100}%`, marginLeft: pct < 0 ? `${(1 - Math.abs(pct)) * 100}%` : 0, background: tone }} />
      </div>
    </div>
  );
}
