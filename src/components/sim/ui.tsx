export const CARD = 'rounded-xl border border-[var(--border)] bg-[var(--surface-1)]';

export function Metric({
  label,
  value,
  unit,
  tone,
  bar,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'good' | 'warn' | 'bad';
  bar?: number;
}) {
  const color = tone ? `var(--${tone})` : 'var(--text-1)';
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="tnum text-[19px] font-semibold leading-none" style={{ color }}>{value}</span>
        {unit && <span className="text-[11px] text-[var(--text-3)]">{unit}</span>}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(4, bar * 100)}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  active,
  activeTone = 'accent',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  activeTone?: 'accent' | 'warn' | 'bad';
  disabled?: boolean;
}) {
  const activeBg = active
    ? activeTone === 'bad'
      ? 'bg-[var(--bad)] text-black'
      : activeTone === 'warn'
        ? 'bg-[var(--warn)] text-black'
        : 'bg-[var(--accent)] text-white'
    : 'bg-[var(--surface-2)] text-[var(--text-1)] hover:bg-[var(--surface-3)] ring-1 ring-[var(--border)]';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${activeBg}`}
    >
      {children}
    </button>
  );
}

export function LegendGlyph({ color, shape }: { color: string; shape: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0">
      {shape === 'tri' && <path d="M8 3l5 9H3z" fill={color} />}
      {shape === 'dot' && <circle cx="8" cy="8" r="4" fill={color} />}
      {shape === 'bar' && <rect x="2" y="6" width="12" height="4" rx="1.5" fill={color} />}
    </svg>
  );
}
