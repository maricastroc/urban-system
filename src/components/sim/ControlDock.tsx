import { unitsToRate } from './types';
import { IconPause, IconPlay, IconReset, IconFastForward } from './icons';

export function ControlDock({
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  demand,
  onDemand,
  onReset,
  onFastForward,
  clockRef,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  demand: number;
  onDemand: (d: number) => void;
  onReset: () => void;
  onFastForward: () => void;
  clockRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const speeds = [1, 2, 4];
  const idx = speeds.indexOf(speed);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-(--border-strong) bg-(--surface-2)/95 px-2.5 py-2 backdrop-blur-md sm:gap-3 sm:px-3"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-9 w-9 place-items-center rounded-xl bg-(--accent) text-white transition-transform duration-150 hover:scale-105 active:scale-95"
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>

        <div className="relative flex rounded-xl bg-(--surface-3) p-0.5">
          <div
            className="absolute inset-y-0.5 left-0.5 rounded-lg bg-(--surface-1) ring-1 ring-(--border) transition-transform duration-200"
            style={{ transform: `translateX(${idx * 100}%)`, width: 'calc((100% - 4px) / 3)' }}
          />
          {speeds.map((x) => (
            <button
              key={x}
              onClick={() => onSpeed(x)}
              className={`tnum relative z-10 w-9 rounded-lg py-1 text-[12px] font-semibold transition-colors ${
                speed === x ? 'text-(--text-1)' : 'text-(--text-3) hover:text-(--text-2)'
              }`}
            >
              {x}×
            </button>
          ))}
        </div>

        <div className="mx-0.5 h-7 w-px bg-(--border) sm:mx-1" />

        <div className="flex items-center gap-2 sm:gap-2.5">
          <span className="eyebrow hidden sm:inline">Demand</span>
          <input
            type="range"
            min={0}
            max={20}
            value={demand}
            onChange={(e) => onDemand(Number(e.target.value))}
            className="range-instr w-20 sm:w-36"
            style={{ '--fill': `${(demand / 20) * 100}%` } as React.CSSProperties}
          />
          <span className="tnum w-11 text-right text-[12px] text-(--text-2)">
            {unitsToRate(demand).toFixed(1)}/s
          </span>
        </div>

        <div className="mx-0.5 h-7 w-px bg-(--border) sm:mx-1" />

        <span
          ref={clockRef}
          data-tooltip-id="uf-tip"
          data-tooltip-content="Simulation time since the seed started"
          aria-label="Elapsed simulation time"
          className="tnum w-11 cursor-default text-right text-[13px] font-semibold tracking-tight text-(--text-2)"
        >
          0:00
        </span>

        <button
          onClick={onFastForward}
          aria-label="Skip ahead 60 seconds"
          title="Skip ahead 60s"
          className="grid h-9 w-9 place-items-center rounded-xl text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)"
        >
          <IconFastForward />
        </button>
        <button
          onClick={onReset}
          aria-label="Reset"
          className="grid h-9 w-9 place-items-center rounded-xl text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)"
        >
          <IconReset />
        </button>
      </div>
    </div>
  );
}
