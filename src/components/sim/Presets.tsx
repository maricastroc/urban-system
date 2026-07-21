import { PRESETS, type Preset } from '@/render/presets';
import { CARD } from './ui';
import { IconBolt } from './icons';

export function Presets({ onApply }: { onApply: (preset: Preset) => void }) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconBolt />
        <div className="eyebrow">Scenario presets</div>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-(--text-3)">
        Applying a preset clears the current traffic and restarts from an empty network — this keeps the A/B comparison reproducible.
      </p>
      <div className="flex flex-col gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onApply(p)}
            className="flex items-start gap-2.5 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2.5 text-left transition-all duration-150 hover:border-(--border-strong) hover:bg-(--surface-3)"
          >
            <span className="mt-1.25 h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--${p.tone})` }} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-(--text-1)">{p.label}</div>
              <div className="text-[11px] leading-snug text-(--text-3)">{p.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
