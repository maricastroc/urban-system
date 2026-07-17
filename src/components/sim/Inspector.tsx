import {
  toggleLaneClosed,
  toggleIncident,
  toggleDestination,
  setSourceRate,
  toggleSignal,
  flipPriority,
  type Scene,
  type SourceCtl,
} from '@/render/scene';
import type { Selection, SelStats } from './types';
import { CARD, Metric, ActionButton, LegendGlyph } from './ui';
import { IconClose } from './icons';

export function Inspector({
  scene,
  sel,
  stats,
  bump,
  onClear,
  sinkLabelOf,
}: {
  scene: Scene;
  sel: Selection;
  stats: SelStats | null;
  bump: () => void;
  onClear: () => void;
  sinkLabelOf: (sink: number) => string;
}) {
  if (sel.kind === 'none') return <InspectorEmpty />;

  return (
    <section className={`${CARD} anim-up p-4`} key={sel.kind === 'lane' ? `l${sel.lane}` : `j${sel.j}`}>
      {sel.kind === 'junction' ? (
        <JunctionInspector scene={scene} j={sel.j} stats={stats} bump={bump} onClear={onClear} />
      ) : (
        <LaneInspector scene={scene} lane={sel.lane} s={sel.s} stats={stats} bump={bump} onClear={onClear} sinkLabelOf={sinkLabelOf} />
      )}
    </section>
  );
}

function InspectorEmpty() {
  const rows = [
    { c: 'var(--good)', shape: 'tri', t: 'Entries & exits', d: 'Set demand and destinations per gateway.' },
    { c: 'var(--accent)', shape: 'dot', t: 'Junctions', d: 'Add signals or flip which street has priority.' },
    { c: 'var(--text-2)', shape: 'bar', t: 'Roads', d: 'Close a road or drop an incident to reroute flow.' },
  ];
  return (
    <section className={`${CARD} anim-fade p-4`}>
      <div className="eyebrow mb-3">Inspector</div>
      <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-2)]">
        Click anything on the map to inspect it and run an experiment. Nothing is hidden in menus.
      </p>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.t} className="flex items-start gap-3">
            <LegendGlyph color={r.c} shape={r.shape} />
            <div>
              <div className="text-[12.5px] font-medium text-[var(--text-1)]">{r.t}</div>
              <div className="text-[12px] leading-snug text-[var(--text-3)]">{r.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text-3)]">
        Speed reads as heat — <span style={{ color: 'rgb(235,110,102)' }}>jammed</span> to{' '}
        <span style={{ color: 'rgb(126,196,220)' }}>free-flow</span>. Roads, junctions and flow pulses
        warm and slow where the network is under load.
      </div>
    </section>
  );
}

function InspectorHeader({ kind, title, onClear }: { kind: string; title: string; onClear: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <div className="eyebrow">{kind}</div>
        <div className="text-[15px] font-semibold tracking-tight">{title}</div>
      </div>
      <button
        onClick={onClear}
        aria-label="Close"
        className="grid h-7 w-7 place-items-center rounded-lg text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
      >
        <IconClose />
      </button>
    </div>
  );
}

function LaneInspector({
  scene,
  lane,
  s,
  stats,
  bump,
  onClear,
  sinkLabelOf,
}: {
  scene: Scene;
  lane: number;
  s: number;
  stats: SelStats | null;
  bump: () => void;
  onClear: () => void;
  sinkLabelOf: (sink: number) => string;
}) {
  const control = scene.world.control;
  const closed = control.laneClosed[lane] === 1;
  const hasIncident = control.incidentAt[lane] < Infinity;
  const srcCtl = scene.sources.find((s2) => s2.lane === lane);
  const ls = stats?.kind === 'lane' ? stats : null;
  const hasCars = !!ls && ls.cars > 0;
  const congestion = hasCars && ls.freeKmh > 0 ? 1 - Math.min(1, ls.speedKmh / ls.freeKmh) : 0;

  return (
    <>
      <InspectorHeader kind={srcCtl ? 'Entry' : 'Road'} title={`Lane ${lane}`} onClear={onClear} />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Metric label="On this road" value={ls ? String(ls.cars) : '—'} unit="cars" />
        <Metric
          label="Speed"
          value={hasCars ? String(Math.round(ls.speedKmh)) : '—'}
          unit="km/h"
          tone={!hasCars ? undefined : congestion > 0.6 ? 'bad' : congestion > 0.3 ? 'warn' : 'good'}
          bar={hasCars ? Math.min(1, ls.speedKmh / ls.freeKmh) : 0}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ActionButton active={closed} activeTone="bad" onClick={() => { toggleLaneClosed(scene, lane); bump(); }}>
          {closed ? 'Reopen road' : 'Close road'}
        </ActionButton>
        <ActionButton active={hasIncident} activeTone="warn" onClick={() => { toggleIncident(scene, lane, s); bump(); }}>
          {hasIncident ? 'Clear incident' : 'Add incident'}
        </ActionButton>
      </div>

      {srcCtl && <EntryControls scene={scene} ctl={srcCtl} bump={bump} sinkLabelOf={sinkLabelOf} />}
    </>
  );
}

function EntryControls({
  scene,
  ctl,
  bump,
  sinkLabelOf,
}: {
  scene: Scene;
  ctl: SourceCtl;
  bump: () => void;
  sinkLabelOf: (sink: number) => string;
}) {
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Demand</span>
        <span className="tnum text-[12px] text-[var(--text-2)]">{ctl.rate.toFixed(1)}/s</span>
      </div>
      <input
        type="range"
        min={0}
        max={20}
        value={Math.round(ctl.rate * 10)}
        onChange={(e) => { setSourceRate(scene, ctl, Number(e.target.value) / 10); bump(); }}
        className="range-instr w-full"
        style={{ '--fill': `${(ctl.rate / 2) * 100}%` } as React.CSSProperties}
      />

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="eyebrow">Destinations</span>
        <span className="tnum text-[11px] text-[var(--text-3)]">{ctl.allowed.size}/{ctl.reachable.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ctl.reachable.map((sink) => {
          const on = ctl.allowed.has(sink);
          return (
            <button
              key={sink}
              onClick={() => { toggleDestination(scene, ctl, sink); bump(); }}
              className={`tnum rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 ${
                on
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-2)] ring-1 ring-[var(--accent)]/40'
                  : 'bg-[var(--surface-3)] text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              {sinkLabelOf(sink)}
            </button>
          );
        })}
      </div>
      {ctl.allowed.size === 0 && (
        <p className="mt-2 text-[11px] text-[var(--bad)]">No destinations — this entry is paused.</p>
      )}
    </div>
  );
}

function JunctionInspector({
  scene,
  j,
  stats,
  bump,
  onClear,
}: {
  scene: Scene;
  j: number;
  stats: SelStats | null;
  bump: () => void;
  onClear: () => void;
}) {
  const signalized = scene.signals[j]?.enabled === true;
  const js = stats?.kind === 'junction' ? stats : null;

  return (
    <>
      <InspectorHeader kind="Junction" title={scene.junctions[j].node} onClear={onClear} />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Metric label="Queued" value={js ? String(js.queued) : '—'} unit="cars" tone={js && js.queued > 4 ? 'bad' : js && js.queued > 1 ? 'warn' : 'good'} />
        <Metric
          label={signalized ? 'Green' : 'Control'}
          value={signalized && js ? js.greenAxis : signalized ? '—' : 'Priority'}
          unit={signalized && js ? `${js.secLeft.toFixed(0)}s left` : ''}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ActionButton active={signalized} activeTone="warn" onClick={() => { toggleSignal(scene, j); bump(); }}>
          {signalized ? 'Signals on' : 'Add signals'}
        </ActionButton>
        <ActionButton disabled={signalized} onClick={() => { flipPriority(scene, j); bump(); }}>
          Flip priority
        </ActionButton>
      </div>
      <p className="mt-3 text-[11.5px] leading-snug text-[var(--text-3)]">
        {signalized
          ? 'Approaches alternate green on a fixed cycle.'
          : 'Give-way: the major street crosses first. Flip to swap right of way.'}
      </p>
    </>
  );
}
