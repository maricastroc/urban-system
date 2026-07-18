type SpanRef = React.RefObject<HTMLSpanElement | null>;

export function TopBar({
  playing,
  hudCars,
  hudFlow,
  hudSpeed,
  hudTrips,
}: {
  playing: boolean;
  hudCars: SpanRef;
  hudFlow: SpanRef;
  hudSpeed: SpanRef;
  hudTrips: SpanRef;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-(--border) px-4 sm:h-18 sm:gap-4 md:px-5">
      <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
        <BrandMark />
        <div className="leading-tight whitespace-nowrap">
          <div className="text-[13px] font-semibold tracking-tight">Urban Flow</div>
          <div className="eyebrow hidden sm:block">Mobility engine</div>
        </div>
      </div>
      <div className="flex min-w-0 items-stretch">
        {/* One "Live" tag frames the whole HUD as the network's instantaneous state,
            so its km/h reads as *now* — distinct from the A/B panel's run averages. */}
        <div className="mr-0.5 flex items-center gap-1.5 self-center pr-1 sm:mr-2.5 sm:pr-2">
          <span
            className={`h-1.5 w-1.5 rounded-full bg-(--good) ${playing ? 'pulse-dot' : 'opacity-40'}`}
          />
          <span className="eyebrow text-(--good)">Live</span>
        </div>
        <HudStat label="Cars" valueRef={hudCars} />
        <HudStat label="Flow /min" valueRef={hudFlow} className="hidden sm:flex" />
        <HudStat label="km/h" valueRef={hudSpeed} />
        <HudStat label="Trips" valueRef={hudTrips} className="hidden md:flex" />
      </div>
    </header>
  );
}

function BrandMark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/app-icon.svg" alt="Urban Flow" className="h-8 w-8" />;
}

function HudStat({
  label,
  valueRef,
  className = '',
}: {
  label: string;
  valueRef: SpanRef;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-end gap-1.5 rounded-xl px-2.5 py-1 transition-colors hover:bg-(--surface-2)/60 sm:px-5 ${className}`}
    >
      <span ref={valueRef} className="tnum text-[22px] font-semibold leading-none tracking-tight text-(--text-1)">
        0
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}
