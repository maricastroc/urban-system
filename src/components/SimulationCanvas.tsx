'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick, NONE } from '@/engine';
import {
  createScene,
  setDemandRate,
  setSourceRate,
  toggleDestination,
  toggleLaneClosed,
  toggleIncident,
  flipPriority,
  toggleSignal,
  sampleStats,
  type Scene,
  type SourceCtl,
  type Stats,
} from '@/render/scene';
import { fitCamera, project, unproject, nearestLane } from '@/render/geometry';
import { drawScene, type RenderCar, type RenderOverlay } from '@/render/renderer';

const SIM_DT = 0.2;
const MAX_STEPS = 5;
const DEFAULT_DEMAND = 4;
const LANE_TOL_M = 7;
const JUNCTION_TOL_PX = 15;

const unitsToRate = (u: number) => u * 0.1;

type Selection =
  | { kind: 'none' }
  | { kind: 'lane'; lane: number; s: number }
  | { kind: 'junction'; j: number };

const NONE_SEL: Selection = { kind: 'none' };

type SelStats =
  | { kind: 'lane'; cars: number; speedKmh: number; freeKmh: number; closed: boolean; incident: boolean; isSource: boolean }
  | { kind: 'junction'; node: string; queued: number; signalized: boolean; greenAxis: string; secLeft: number };

function computeSelStats(scene: Scene, sel: Selection): SelStats | null {
  if (sel.kind === 'none') return null;
  const { agents, occ, graph, vparams, control } = scene.world;
  if (sel.kind === 'lane') {
    let cars = 0;
    let sum = 0;
    for (let id = occ.head[sel.lane]; id !== NONE; id = agents.behind[id]) {
      cars += 1;
      sum += agents.v[id];
    }
    const v0 = graph.speedLimit[sel.lane] * vparams[0].v0Factor;
    return {
      kind: 'lane',
      cars,
      speedKmh: cars ? (sum / cars) * 3.6 : 0,
      freeKmh: v0 * 3.6,
      closed: control.laneClosed[sel.lane] === 1,
      incident: control.incidentAt[sel.lane] < Infinity,
      isSource: scene.sources.some((s) => s.lane === sel.lane),
    };
  }
  const j = scene.junctions[sel.j];
  let queued = 0;
  for (const ap of j.approaches) {
    for (let id = occ.head[ap.fromLane]; id !== NONE; id = agents.behind[id]) {
      if (agents.v[id] < 0.6) queued += 1;
    }
  }
  const sc = scene.signals[sel.j];
  const signalized = sc?.enabled === true;
  return {
    kind: 'junction',
    node: j.node,
    queued,
    signalized,
    greenAxis: signalized ? (sc!.phase === 0 ? 'E–W' : 'N–S') : '',
    secLeft: signalized ? Math.max(0, sc!.phaseDur[sc!.phase] - sc!.timeInPhase) : 0,
  };
}

/** Compass label (N/E/S/W + per-side index) for each perimeter lane endpoint. */
function compassLabels(pts: { x: number; y: number }[]): string[] {
  if (pts.length === 0) return [];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const counts: Record<string, number> = { N: 0, E: 0, S: 0, W: 0 };
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    counts[side] += 1;
    return `${side}${counts[side]}`;
  });
}

function scenarioChanged(scene: Scene): boolean {
  const c = scene.world.control;
  for (let i = 0; i < c.laneClosed.length; i++) if (c.laneClosed[i] === 1) return true;
  for (let i = 0; i < c.incidentAt.length; i++) if (c.incidentAt[i] < Infinity) return true;
  return c.signals.some((s) => s.enabled);
}

export function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [scene, setSceneState] = useState<Scene>(() => createScene(unitsToRate(DEFAULT_DEMAND)));
  const sceneRef = useRef<Scene>(scene);
  const cap0 = scene.world.agents.capacity;
  const prevSRef = useRef<Float32Array>(new Float32Array(cap0));
  const prevActiveRef = useRef<Uint8Array>(new Uint8Array(cap0));
  const prevLaneRef = useRef<Int32Array>(new Int32Array(cap0));
  const accRef = useRef(0);
  const lastTsRef = useRef(0);

  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const selRef = useRef<Selection>(NONE_SEL);
  const hoverLaneRef = useRef(-1);
  const hoverJctRef = useRef(-1);

  // Live HUD readouts (updated imperatively each frame; tweened for a smooth count).
  const hudCars = useRef<HTMLSpanElement>(null);
  const hudFlow = useRef<HTMLSpanElement>(null);
  const hudSpeed = useRef<HTMLSpanElement>(null);
  const hudTrips = useRef<HTMLSpanElement>(null);
  const dispRef = useRef({ cars: 0, flow: 0, speed: 0 });
  const flowRef = useRef({ t: 0, trips: 0, val: 0 });

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(DEFAULT_DEMAND);
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [selStats, setSelStats] = useState<SelStats | null>(null);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [snapA, setSnapA] = useState<Stats | null>(null);
  const [snapB, setSnapB] = useState<Stats | null>(null);
  const [coachDismissed, setCoachDismissed] = useState(false);

  useEffect(() => void (playingRef.current = playing), [playing]);
  useEffect(() => void (speedRef.current = speed), [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);
  useEffect(() => {
    setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

  // Sync the loop's scene pointer + interpolation buffers with the (re)built scene.
  useEffect(() => {
    sceneRef.current = scene;
    const cap = scene.world.agents.capacity;
    prevSRef.current = new Float32Array(cap);
    prevActiveRef.current = new Uint8Array(cap);
    prevLaneRef.current = new Int32Array(cap);
    prevSRef.current.set(scene.world.agents.s);
    prevActiveRef.current.set(scene.world.agents.active);
    prevLaneRef.current.set(scene.world.agents.lane);
    accRef.current = 0;
    flowRef.current = { t: 0, trips: 0, val: 0 };
    dispRef.current = { cars: 0, flow: 0, speed: 0 };
  }, [scene]);

  // Select an item and snapshot its live stats at once; the interval below keeps them fresh.
  const select = useCallback((next: Selection) => {
    setSel(next);
    setSelStats(next.kind === 'none' ? null : computeSelStats(sceneRef.current, next));
  }, []);

  // Refresh the selected item's live stats at ~5 Hz while something is selected.
  useEffect(() => {
    if (sel.kind === 'none') return;
    const id = window.setInterval(
      () => setSelStats(computeSelStats(sceneRef.current, selRef.current)),
      200,
    );
    return () => window.clearInterval(id);
  }, [sel]);

  const reset = useCallback(() => {
    setSceneState(createScene(unitsToRate(demand)));
    setSel(NONE_SEL);
    setSelStats(null);
    setSnapA(null);
    setSnapB(null);
  }, [demand]);

  const hitTest = useCallback((clientX: number, clientY: number): Selection => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return NONE_SEL;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cam = fitCamera(scene.geometry, rect.width, rect.height);

    let bestJ = -1;
    let bestJD = JUNCTION_TOL_PX;
    scene.junctions.forEach((j, idx) => {
      const sp = project(cam, j.pos.x, j.pos.y);
      const d = Math.hypot(sp.x - px, sp.y - py);
      if (d < bestJD) {
        bestJD = d;
        bestJ = idx;
      }
    });
    if (bestJ >= 0) return { kind: 'junction', j: bestJ };

    const world = unproject(cam, px, py);
    const hit = nearestLane(scene.geometry, world, LANE_TOL_M);
    if (hit.lane >= 0) return { kind: 'lane', lane: hit.lane, s: hit.s };
    return NONE_SEL;
  }, []);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent) => select(hitTest(e.clientX, e.clientY)),
    [hitTest, select],
  );
  const onCanvasMove = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY);
      hoverLaneRef.current = hit.kind === 'lane' ? hit.lane : -1;
      hoverJctRef.current = hit.kind === 'junction' ? hit.j : -1;
      const el = canvasRef.current;
      if (el) el.style.cursor = hit.kind === 'none' ? 'default' : 'pointer';
    },
    [hitTest],
  );
  const onCanvasLeave = useCallback(() => {
    hoverLaneRef.current = -1;
    hoverJctRef.current = -1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const loop = (ts: number) => {
      const scene = sceneRef.current;
      const { world } = scene;
      const { agents } = world;
      const prevS = prevSRef.current;
      const prevActive = prevActiveRef.current;
      const prevLane = prevLaneRef.current;

      const last = lastTsRef.current || ts;
      let dtReal = (ts - last) / 1000;
      lastTsRef.current = ts;
      if (dtReal > 0.1) dtReal = 0.1;

      if (playingRef.current) accRef.current += dtReal * speedRef.current;

      let steps = 0;
      while (accRef.current >= SIM_DT && steps < MAX_STEPS) {
        prevS.set(agents.s);
        prevActive.set(agents.active);
        prevLane.set(agents.lane);
        tick(world);
        accRef.current -= SIM_DT;
        steps += 1;
      }
      const alpha = Math.min(accRef.current / SIM_DT, 1);

      const v0 = world.graph.speedLimit[0] * world.vparams[0].v0Factor;
      const cars: RenderCar[] = [];
      for (let id = 0; id < agents.capacity; id++) {
        if (!agents.active[id]) continue;
        const lane = agents.lane[id];
        const cur = agents.s[id];
        const interp = prevActive[id] === 1 && prevLane[id] === lane;
        const s = interp ? prevS[id] + (cur - prevS[id]) * alpha : cur;
        cars.push({ lane, s, length: world.vparams[agents.type[id]].length, speedFrac: agents.v[id] / v0 });
      }

      const cur = selRef.current;
      const overlay: RenderOverlay = {
        selectedLane: cur.kind === 'lane' ? cur.lane : -1,
        hoverLane: hoverLaneRef.current,
        selectedJunction: cur.kind === 'junction' ? cur.j : -1,
        hoverJunction: hoverJctRef.current,
        now: ts,
      };
      drawScene(ctx, canvas.clientWidth, canvas.clientHeight, scene, cars, overlay);

      // Live HUD — windowed throughput + tweened numerals.
      const st = sampleStats(world);
      const f = flowRef.current;
      if (world.time - f.t >= 1.5) {
        f.val = (world.metrics.completedTrips - f.trips) / (world.time - f.t) * 60;
        f.t = world.time;
        f.trips = world.metrics.completedTrips;
      }
      const d = dispRef.current;
      d.cars += (st.cars - d.cars) * 0.14;
      d.flow += (f.val - d.flow) * 0.1;
      d.speed += (st.avgSpeedKmh - d.speed) * 0.12;
      if (hudCars.current) hudCars.current.textContent = String(Math.round(d.cars));
      if (hudFlow.current) hudFlow.current.textContent = d.flow.toFixed(1);
      if (hudSpeed.current) hudSpeed.current.textContent = String(Math.round(d.speed));
      if (hudTrips.current) hudTrips.current.textContent = String(st.completedTrips);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const sinkLabels = useMemo(
    () => compassLabels(scene.sinks.map((l) => scene.geometry.b[l])),
    [scene],
  );
  const sinkLabelOf = useCallback(
    (sink: number) => {
      const i = scene.sinks.indexOf(sink);
      return i >= 0 ? sinkLabels[i] : `#${sink}`;
    },
    [scene, sinkLabels],
  );

  const capture = (slot: 'A' | 'B') => {
    const st = sampleStats(sceneRef.current.world);
    if (slot === 'A') setSnapA(st);
    else setSnapB(st);
  };

  const changed = scenarioChanged(scene);
  const coachStep = !snapA ? 0 : !changed ? 1 : !snapB ? 2 : 3;

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text-1)]">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
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
          <HudStat label="Flow /min" valueRef={hudFlow} />
          <HudDivider />
          <HudStat label="km/h" valueRef={hudSpeed} />
          <HudDivider className="hidden sm:block" />
          <HudStat label="Trips" valueRef={hudTrips} className="hidden sm:flex" />
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[56dvh] min-h-0 flex-1 lg:h-auto">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={onCanvasLeave}
            className="absolute inset-0 h-full w-full"
          />

          <ControlDock
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeed={setSpeed}
            demand={demand}
            onDemand={setDemand}
            onReset={reset}
          />

          {!coachDismissed && coachStep < 3 && (
            <Coach step={coachStep} onDismiss={() => setCoachDismissed(true)} />
          )}
        </div>

        <aside className="thin-scroll flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-[var(--border)] p-3 lg:w-[368px] lg:border-l lg:border-t-0">
          <Inspector
            scene={scene}
            sel={sel}
            stats={selStats}
            bump={bump}
            onClear={() => select(NONE_SEL)}
            sinkLabelOf={sinkLabelOf}
          />
          <Experiment
            snapA={snapA}
            snapB={snapB}
            onCapture={capture}
            highlightA={!coachDismissed && coachStep === 0}
            highlightB={!coachDismissed && coachStep === 2}
          />
        </aside>
      </div>
    </div>
  );
}

/* ── Brand + HUD ───────────────────────────────────────────────────────── */

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
  className = '',
}: {
  label: string;
  valueRef: React.RefObject<HTMLSpanElement | null>;
  live?: boolean;
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
      <span className="eyebrow mt-1">{label}</span>
    </div>
  );
}

function HudDivider({ className = '' }: { className?: string }) {
  return <div className={`h-7 w-px bg-[var(--border)] ${className}`} />;
}

/* ── Control dock (instruments) ────────────────────────────────────────── */

function ControlDock({
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  demand,
  onDemand,
  onReset,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  demand: number;
  onDemand: (d: number) => void;
  onReset: () => void;
}) {
  const speeds = [1, 2, 4];
  const idx = speeds.indexOf(speed);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)]/95 px-2.5 py-2 backdrop-blur-md sm:gap-3 sm:px-3"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-white transition-transform duration-150 hover:scale-105 active:scale-95"
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>

        <div className="relative flex rounded-xl bg-[var(--surface-3)] p-0.5">
          <div
            className="absolute inset-y-0.5 left-0.5 rounded-lg bg-[var(--surface-1)] ring-1 ring-[var(--border)] transition-transform duration-200"
            style={{ transform: `translateX(${idx * 100}%)`, width: 'calc((100% - 4px) / 3)' }}
          />
          {speeds.map((x) => (
            <button
              key={x}
              onClick={() => onSpeed(x)}
              className={`tnum relative z-10 w-9 rounded-lg py-1 text-[12px] font-semibold transition-colors ${
                speed === x ? 'text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
              }`}
            >
              {x}×
            </button>
          ))}
        </div>

        <div className="mx-0.5 h-7 w-px bg-[var(--border)] sm:mx-1" />

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
          <span className="tnum w-11 text-right text-[12px] text-[var(--text-2)]">
            {unitsToRate(demand).toFixed(1)}/s
          </span>
        </div>

        <div className="mx-0.5 h-7 w-px bg-[var(--border)] sm:mx-1" />

        <button
          onClick={onReset}
          aria-label="Reset"
          className="grid h-9 w-9 place-items-center rounded-xl text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
        >
          <IconReset />
        </button>
      </div>
    </div>
  );
}

/* ── Guided coach ──────────────────────────────────────────────────────── */

const COACH_STEPS = [
  { title: 'Capture the baseline', body: 'Snapshot the free-flowing network — your control group.' },
  { title: 'Disrupt the network', body: 'Click a road on the map, then close it or add an incident.' },
  { title: 'Watch it settle, capture B', body: 'Let queues build, then snapshot the result.' },
];

function Coach({ step, onDismiss }: { step: number; onDismiss: () => void }) {
  const s = COACH_STEPS[Math.min(step, COACH_STEPS.length - 1)];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-3">
      <div
        className="anim-up pointer-events-auto flex max-w-[420px] items-start gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)]/95 py-2.5 pl-3 pr-2.5 backdrop-blur-md"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="tnum mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent-2)]">
          {step + 1}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-tight">{s.title}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-2)]">{s.body}</div>
          <div className="mt-2 flex items-center gap-1.5">
            {COACH_STEPS.map((_, i) => (
              <span
                key={i}
                className="h-1 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 18 : 6,
                  background: i <= step ? 'var(--accent)' : 'var(--border-strong)',
                }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}

/* ── Inspector ─────────────────────────────────────────────────────────── */

const CARD = 'rounded-xl border border-[var(--border)] bg-[var(--surface-1)]';

function Inspector({
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

/* ── Experiment A/B ────────────────────────────────────────────────────── */

function Experiment({
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
  const metrics: { label: string; get: (s: Stats) => number; fmt: (n: number) => string; better: 'up' | 'down' }[] = [
    { label: 'Throughput', get: (s) => (s.time ? (s.completedTrips / s.time) * 60 : 0), fmt: (n) => `${n.toFixed(1)}/min`, better: 'up' },
    { label: 'Avg speed', get: (s) => s.avgSpeedKmh, fmt: (n) => `${Math.round(n)} km/h`, better: 'up' },
    { label: 'Avg trip time', get: (s) => s.avgTravelTime, fmt: (n) => (n ? `${Math.round(n)} s` : '—'), better: 'down' },
  ];

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
          {metrics.map((m) => {
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
  const eps = 1e-6;
  const improved = Math.abs(delta) < eps ? null : (delta > 0) === (better === 'up');
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

/* ── Small building blocks ─────────────────────────────────────────────── */

function Metric({
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

function ActionButton({
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

function LegendGlyph({ color, shape }: { color: string; shape: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0">
      {shape === 'tri' && <path d="M8 3l5 9H3z" fill={color} />}
      {shape === 'dot' && <circle cx="8" cy="8" r="4" fill={color} />}
      {shape === 'bar' && <rect x="2" y="6" width="12" height="4" rx="1.5" fill={color} />}
    </svg>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function IconPlay() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.42 2.7a.6.6 0 0 0-.92.5z" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}
function IconReset() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5H10.5" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
function IconFlask() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent-2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 2v4L3 12.5A1 1 0 0 0 3.9 14h8.2a1 1 0 0 0 .9-1.5L9.5 6V2M5.5 2h5" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h9M9 5l3 3-3 3" />
    </svg>
  );
}
