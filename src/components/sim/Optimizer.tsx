import { useEffect, useRef, useState } from 'react';
import type { Stats } from '@/render/scene';
import type { SweepRow, Candidate } from '@/render/optimize';
import { CARD } from './ui';
import { IconTarget } from './icons';

const LOW_LOAD_CARS = 20;

const pct = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`;
const toneOf = (d: number) => (d > 0.005 ? 'var(--good)' : d < -0.005 ? 'var(--bad)' : 'var(--text-3)');

export function Optimizer({
  running,
  done,
  total,
  result,
  onRun,
  onStage,
  isStaged,
  stale,
}: {
  running: boolean;
  done: number;
  total: number;
  result: { baseline: Stats; rows: SweepRow[]; sig: string } | null;
  onRun: () => void;
  onStage: (c: Candidate) => void;
  isStaged: (c: Candidate) => boolean;
  stale: boolean;
}) {
  const best = result?.rows[0];
  const helps = !!best && best.tripsDelta > 0.005;
  const underloaded = !!result && result.baseline.cars < LOW_LOAD_CARS;

  const [staged, setStaged] = useState<{ kind: Candidate['kind']; id: number } | null>(null);
  const stageId = useRef(0);
  useEffect(() => {
    if (!staged) return;
    const t = setTimeout(() => setStaged(null), 2000);
    return () => clearTimeout(t);
  }, [staged]);

  const stage = (c: Candidate) => {
    onStage(c);
    stageId.current += 1;
    setStaged({ kind: c.kind, id: stageId.current });
  };

  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-1 flex items-center gap-2">
        <IconTarget />
        <div className="eyebrow">Optimizer</div>
      </div>
      <p className="mb-3 text-[11.5px] leading-snug text-(--text-3)">
        Tests every remaining signal, priority and green-wave change on top of your current network — same seed, same demand — and ranks the best next move.
      </p>

      {!result && (
        <button
          onClick={onRun}
          disabled={running}
          className={`w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 disabled:cursor-not-allowed ${
            running
              ? 'bg-(--surface-2) text-(--text-2)'
              : 'bg-transparent text-(--accent-2) ring-1 ring-(--accent)/30 hover:bg-(--accent-soft) hover:text-(--accent)'
          }`}
        >
          {running ? `Testing ${done}/${total}…` : 'Find the best fix'}
        </button>
      )}

      {running && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-(--surface-3)">
          <div className="h-full rounded-full bg-(--accent) transition-all duration-150" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      )}

      {result && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Best interventions</span>
            <button
              onClick={onRun}
              disabled={running}
              className="eyebrow transition-[filter] hover:brightness-110 disabled:opacity-40"
              style={{ color: stale ? 'var(--warn)' : 'var(--accent-2)' }}
            >
              {running ? `${done}/${total}` : 'Rerun'}
            </button>
          </div>

          {stale && (
            <div className="mb-2 rounded-lg bg-(--warn)/10 px-2.5 py-1.5 text-[11px] leading-snug text-(--warn) ring-1 ring-(--warn)/25">
              Network changed — these results are from an earlier configuration. Rerun to update them.
            </div>
          )}

          {!stale && !helps && (
            <p className="mb-2 text-[11.5px] leading-snug text-(--warn)">
              {underloaded
                ? 'Barely any traffic to optimize at this demand — add load (Rush hour) and rerun.'
                : 'No single change beats your current network at this demand — it may already be near-optimal here. Try a heavier scenario (Rush hour) to stress-test it.'}
            </p>
          )}

          <div className="flex flex-col gap-1">
            {result.rows.slice(0, 6).map((row, i) => {
              const active = isStaged(row.candidate);
              const top = i === 0 && helps && !active;
              return (
                <button
                  key={row.candidate.id}
                  onClick={() => stage(row.candidate)}
                  title={active ? 'Live on the network — click to re-stage' : 'Stage this on the live network'}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-(--good)/10 ring-1 ring-(--good)/45'
                      : top
                        ? 'bg-(--accent-soft) ring-1 ring-(--accent)/40'
                        : 'bg-(--surface-2) hover:bg-(--surface-3)'
                  }`}
                >
                  <span className="tnum w-4 shrink-0 text-center text-[11px] font-bold text-(--text-3)">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-(--text-1)">{row.candidate.label}</span>
                  {active && (
                    <span className="shrink-0 text-[11px] font-bold text-(--good)" title="Staged">✓</span>
                  )}
                  <span
                    className="tnum text-[12px] font-semibold"
                    style={{ color: stale ? 'var(--text-3)' : toneOf(row.tripsDelta), opacity: stale ? 0.55 : 1 }}
                  >
                    {pct(row.tripsDelta)}
                  </span>
                </button>
              );
            })}
          </div>

          {staged && (
            <p key={staged.id} className="anim-up mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-(--good)">
              <span aria-hidden>✓</span>
              {staged.kind === 'signal' ? 'Signals staged' : staged.kind === 'greenwave' ? 'Green wave staged' : 'Priority flipped'} on the live network
            </p>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-(--text-3)">
            Δ trips over 1 sim-min vs. your current network ({result.baseline.completedTrips} trips). Click a fix to stage it, then run the A/B to confirm.
          </p>
        </div>
      )}
    </section>
  );
}
