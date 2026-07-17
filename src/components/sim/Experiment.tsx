import type { Stats } from '@/render/scene';
import { CARD } from './ui';
import { IconArrow, IconFlask } from './icons';

const METRICS: { label: string; get: (s: Stats) => number; fmt: (n: number) => string; better: 'up' | 'down' }[] = [
  { label: 'Throughput', get: (s) => (s.time ? (s.completedTrips / s.time) * 60 : 0), fmt: (n) => `${n.toFixed(1)}/min`, better: 'up' },
  { label: 'Avg speed', get: (s) => s.avgSpeedKmh, fmt: (n) => `${Math.round(n)} km/h`, better: 'up' },
  { label: 'Avg trip time', get: (s) => s.avgTravelTime, fmt: (n) => (n ? `${Math.round(n)} s` : '—'), better: 'down' },
];

export function Experiment({
  snapA,
  snapB,
  onCapture,
  highlightA,
  highlightB,
}: {
  snapA: Stats | null;
  snapB: Stats | null;
  onCapture: (slot: 'A' | 'B') => void;
  highlightA: boolean;
  highlightB: boolean;
}) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconFlask />
        <div className="eyebrow">Experiment · A/B</div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <CaptureButton label="A" sub="Before" filled={!!snapA} highlight={highlightA} onClick={() => onCapture('A')} />
        <CaptureButton label="B" sub="After" filled={!!snapB} highlight={highlightB} onClick={() => onCapture('B')} />
      </div>

      {snapA && snapB ? (
        <div className="flex flex-col gap-1">
          {METRICS.map((m) => {
            const a = m.get(snapA);
            const b = m.get(snapB);
            return <ImpactRow key={m.label} label={m.label} a={m.fmt(a)} b={m.fmt(b)} delta={b - a} better={m.better} rel={a ? (b - a) / Math.abs(a) : 0} />;
          })}
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-[var(--text-3)]">
          {snapA
            ? 'Baseline captured. Change the network, let it settle, then capture B.'
            : 'Capture a baseline (A), change the scenario, then capture the result (B) to measure the impact.'}
        </p>
      )}
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
        <span className="text-[12.5px] text-[var(--text-2)]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="tnum text-[12px] text-[var(--text-3)]">{a}</span>
          <IconArrow />
          <span className="tnum text-[12.5px] font-semibold text-[var(--text-1)]">{b}</span>
          <span className="tnum w-14 text-right text-[11px] font-semibold" style={{ color: tone }}>
            {improved === null ? '±0' : `${delta > 0 ? '+' : ''}${(rel * 100).toFixed(0)}%`}
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.abs(pct) * 100}%`, marginLeft: pct < 0 ? `${(1 - Math.abs(pct)) * 100}%` : 0, background: tone }} />
      </div>
    </div>
  );
}

function CaptureButton({
  label,
  sub,
  filled,
  highlight,
  onClick,
}: {
  label: string;
  sub: string;
  filled: boolean;
  highlight: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-all duration-150 ${
        filled
          ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]'
          : 'border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
      } ${highlight ? 'hint-ring' : ''}`}
    >
      <div>
        <div className="eyebrow">{sub}</div>
        <div className={`text-[13px] font-semibold ${filled ? 'text-[var(--accent-2)]' : 'text-[var(--text-1)]'}`}>
          Scenario {label}
        </div>
      </div>
      <span
        className={`tnum grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
          filled ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-3)] text-[var(--text-3)]'
        }`}
      >
        {filled ? '✓' : label}
      </span>
    </button>
  );
}
