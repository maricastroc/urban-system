import { Sparkline, type SparkHandle } from './Sparkline';

type SpanRef = React.RefObject<HTMLSpanElement | null>;
type SparkRef = React.RefObject<SparkHandle | null>;

export function TopBar({
  playing,
  hudCars,
  hudFlow,
  hudSpeed,
  hudTrips,
  flowSpark,
  speedSpark,
  freeKmh,
}: {
  playing: boolean;
  hudCars: SpanRef;
  hudFlow: SpanRef;
  hudSpeed: SpanRef;
  hudTrips: SpanRef;
  flowSpark: SparkRef;
  speedSpark: SparkRef;
  freeKmh: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] px-4 md:px-5">
      <div className="flex items-center gap-3">
        <BrandMark />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Urban Flow</div>
          <div className="eyebrow">Mobility engine</div>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:gap-5">
        <HudStat label="Cars" valueRef={hudCars} live={playing} />
        <HudDivider />
        <HudStat label="Flow /min" valueRef={hudFlow} spark={<Sparkline ref={flowSpark} color="var(--accent)" />} />
        <HudDivider />
        <HudStat label="km/h" valueRef={hudSpeed} spark={<Sparkline ref={speedSpark} color="var(--good)" max={freeKmh} />} />
        <HudDivider className="hidden sm:block" />
        <HudStat label="Trips" valueRef={hudTrips} className="hidden sm:flex" />
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <div className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)]">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 5.5h12M2 10.5h12" stroke="var(--text-3)" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="5" cy="5.5" r="1.6" fill="var(--accent)" />
        <circle cx="10.5" cy="10.5" r="1.6" fill="var(--good)" />
      </svg>
    </div>
  );
}

function HudStat({
  label,
  valueRef,
  live,
  spark,
  className = '',
}: {
  label: string;
  valueRef: SpanRef;
  live?: boolean;
  spark?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-end ${className}`}>
      <div className="flex items-center gap-1.5">
        {live && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--good)]" />}
        <span ref={valueRef} className="tnum text-[15px] font-semibold leading-none text-[var(--text-1)]">
          0
        </span>
      </div>
      {/* Fixed-height trace slot: present on every stat (empty for static ones) so
          the value numerals and labels stay on one baseline across the HUD. */}
      <div className="mt-1 hidden h-4 items-end sm:flex">{spark}</div>
      <span className="eyebrow mt-1">{label}</span>
    </div>
  );
}

function HudDivider({ className = '' }: { className?: string }) {
  return <div className={`h-7 w-px bg-[var(--border)] ${className}`} />;
}
