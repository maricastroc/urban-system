'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick } from '@/engine';
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

const SIM_DT = 0.2; // must match the engine's fixed timestep
const MAX_STEPS = 5; // cap catch-up per frame to avoid a spiral of death
const DEFAULT_DEMAND = 3; // slider units; rate = units * 0.1 cars/second per entry
const LANE_TOL_M = 7; // click tolerance to a lane centreline (world metres)
const JUNCTION_TOL_PX = 15; // click tolerance to a junction (screen pixels)

function unitsToRate(units: number): number {
  return units * 0.1;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'lane'; lane: number; s: number }
  | { kind: 'junction'; j: number };

const NONE_SEL: Selection = { kind: 'none' };

/** Compass label (N/E/S/W + per-side index) for each perimeter lane endpoint. */
function compassLabels(
  pts: { x: number; y: number }[],
): string[] {
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

export function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<HTMLSpanElement>(null);

  // Build the scene once during render (deterministic, fixed seed) and mirror it into a ref for the
  // animation loop; rebuilding (Reset) goes through setSceneState, which the sync effect below picks up.
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

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(DEFAULT_DEMAND);
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [snapA, setSnapA] = useState<Stats | null>(null);
  const [snapB, setSnapB] = useState<Stats | null>(null);

  useEffect(() => void (playingRef.current = playing), [playing]);
  useEffect(() => void (speedRef.current = speed), [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);

  // Tune global demand live on the running scene, no rebuild needed.
  useEffect(() => {
    setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

  // Keep the loop's scene pointer and interpolation buffers in sync with the (re)built scene.
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
  }, [scene]);

  const reset = useCallback(() => {
    setSceneState(createScene(unitsToRate(demand)));
    setSel(NONE_SEL);
    setSnapA(null);
    setSnapB(null);
  }, [demand]);

  // Turn a mouse event into a lane or junction hit.
  const hitTest = useCallback((clientX: number, clientY: number): Selection => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return NONE_SEL;
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
    (e: React.MouseEvent) => setSel(hitTest(e.clientX, e.clientY)),
    [hitTest],
  );
  const onCanvasMove = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY);
      hoverLaneRef.current = hit.kind === 'lane' ? hit.lane : -1;
    },
    [hitTest],
  );
  const onCanvasLeave = useCallback(() => void (hoverLaneRef.current = -1), []);

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
      const scene = sceneRef.current!;
      const { world } = scene;
      const { agents } = world;
      const prevS = prevSRef.current!;
      const prevActive = prevActiveRef.current!;
      const prevLane = prevLaneRef.current!;

      const last = lastTsRef.current || ts;
      let dtReal = (ts - last) / 1000;
      lastTsRef.current = ts;
      if (dtReal > 0.1) dtReal = 0.1; // clamp big gaps (e.g. tab was backgrounded)

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
      };
      drawScene(ctx, canvas.clientWidth, canvas.clientHeight, scene, cars, overlay);

      if (statsRef.current) {
        const st = sampleStats(world);
        statsRef.current.textContent =
          `${st.cars} cars · ${st.avgSpeedKmh.toFixed(0)} km/h · ${st.completedTrips} done` +
          (st.avgTravelTime ? ` · ${st.avgTravelTime.toFixed(0)}s avg trip` : '');
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const sinkLabels = useMemo(
    () => (scene ? compassLabels(scene.sinks.map((l) => scene.geometry.b[l])) : []),
    [scene],
  );
  const sinkLabelOf = useCallback(
    (sink: number) => {
      if (!scene) return `#${sink}`;
      const i = scene.sinks.indexOf(sink);
      return i >= 0 ? sinkLabels[i] : `#${sink}`;
    },
    [scene, sinkLabels],
  );

  const capture = (slot: 'A' | 'B') => {
    if (!scene) return;
    const st = sampleStats(scene.world);
    if (slot === 'A') setSnapA(st);
    else setSnapB(st);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-3 shadow-2xl">
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onMouseMove={onCanvasMove}
          onMouseLeave={onCanvasLeave}
          className="block h-[460px] w-full cursor-pointer"
        />
      </div>

      {/* Transport controls */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-lg bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={reset}
          className="rounded-lg bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
        >
          Reset
        </button>
        <div className="flex items-center gap-1">
          {[1, 2, 4].map((x) => (
            <button
              key={x}
              onClick={() => setSpeed(x)}
              className={`rounded-lg px-3 py-2 font-medium transition ${
                speed === x ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {x}×
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-neutral-300">
          All demand
          <input
            type="range"
            min={0}
            max={20}
            value={demand}
            onChange={(e) => setDemand(Number(e.target.value))}
            className="accent-emerald-500"
          />
          <span className="w-14 tabular-nums text-neutral-400">{unitsToRate(demand).toFixed(1)}/s</span>
        </label>
        <span ref={statsRef} className="ml-auto tabular-nums text-neutral-400" />
      </div>

      {/* Experiment panels */}
      <div className="grid gap-4 md:grid-cols-2">
        <Inspector
          scene={scene}
          sel={sel}
          bump={bump}
          sinkLabelOf={sinkLabelOf}
        />
        <ComparePanel snapA={snapA} snapB={snapB} onCapture={capture} />
      </div>

      <p className="text-xs leading-relaxed text-neutral-500">
        <span className="text-emerald-400">▲ entries</span> ·{' '}
        <span className="text-slate-300">○ exits</span> ·{' '}
        <span className="text-sky-400">● junctions</span>. Click a road to close it or drop an
        incident; click an entry to set its demand and destinations; click a junction to add signals
        or flip priority. Car colour is speed (red stopped → green free-flow).
      </p>
    </div>
  );
}

function Inspector({
  scene,
  sel,
  bump,
  sinkLabelOf,
}: {
  scene: Scene | null;
  sel: Selection;
  bump: () => void;
  sinkLabelOf: (sink: number) => string;
}) {
  const box = 'rounded-xl border border-white/10 bg-neutral-900/60 p-4';
  if (!scene || sel.kind === 'none') {
    return (
      <div className={`${box} text-sm text-neutral-400`}>
        <h3 className="mb-1 font-medium text-neutral-200">Inspector</h3>
        Select a road or junction on the map to experiment with it.
      </div>
    );
  }

  if (sel.kind === 'junction') {
    const control = scene.world.control;
    const j = scene.junctions[sel.j];
    const signalized = scene.signals[sel.j]?.enabled === true;
    return (
      <div className={`${box} text-sm`}>
        <h3 className="mb-3 font-medium text-neutral-200">Junction {j.node}</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              toggleSignal(scene, sel.j);
              bump();
            }}
            className={`rounded-lg px-3 py-2 font-medium transition ${
              signalized ? 'bg-amber-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {signalized ? 'Signals: on' : 'Add signals'}
          </button>
          <button
            onClick={() => {
              flipPriority(scene, sel.j);
              bump();
            }}
            disabled={signalized}
            className="rounded-lg bg-white/10 px-3 py-2 font-medium text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Flip priority
          </button>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {signalized
            ? 'Signalized: approaches alternate green/red on a fixed cycle.'
            : `Priority give-way. Major approach: lane ${majorApproach(control, j)}. Flip to swap which street has right of way.`}
        </p>
      </div>
    );
  }

  // Lane selected.
  const control = scene.world.control;
  const lane = sel.lane;
  const closed = control.laneClosed[lane] === 1;
  const hasIncident = control.incidentAt[lane] < Infinity;
  const srcCtl = scene.sources.find((s) => s.lane === lane);

  return (
    <div className={`${box} text-sm`}>
      <h3 className="mb-3 font-medium text-neutral-200">
        {srcCtl ? 'Entry' : 'Road'} · lane {lane}
      </h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            toggleLaneClosed(scene, lane);
            bump();
          }}
          className={`rounded-lg px-3 py-2 font-medium transition ${
            closed ? 'bg-rose-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {closed ? 'Reopen road' : 'Close road'}
        </button>
        <button
          onClick={() => {
            toggleIncident(scene, lane, sel.s);
            bump();
          }}
          className={`rounded-lg px-3 py-2 font-medium transition ${
            hasIncident ? 'bg-amber-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {hasIncident ? 'Clear incident' : 'Add incident'}
        </button>
      </div>

      {srcCtl && <EntryControls scene={scene} ctl={srcCtl} bump={bump} sinkLabelOf={sinkLabelOf} />}
    </div>
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
    <div className="mt-4 border-t border-white/10 pt-3">
      <label className="flex items-center gap-2 text-neutral-300">
        Demand
        <input
          type="range"
          min={0}
          max={20}
          value={Math.round(ctl.rate * 10)}
          onChange={(e) => {
            setSourceRate(scene, ctl, Number(e.target.value) / 10);
            bump();
          }}
          className="accent-emerald-500"
        />
        <span className="w-14 tabular-nums text-neutral-400">{ctl.rate.toFixed(1)}/s</span>
      </label>

      <div className="mt-3">
        <p className="mb-2 text-xs text-neutral-400">Destinations</p>
        <div className="flex flex-wrap gap-1.5">
          {ctl.reachable.map((sink) => {
            const on = ctl.allowed.has(sink);
            return (
              <button
                key={sink}
                onClick={() => {
                  toggleDestination(scene, ctl, sink);
                  bump();
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  on ? 'bg-emerald-500/90 text-black' : 'bg-white/10 text-neutral-300 hover:bg-white/20'
                }`}
              >
                {sinkLabelOf(sink)}
              </button>
            );
          })}
        </div>
        {ctl.allowed.size === 0 && (
          <p className="mt-2 text-xs text-rose-400">No destinations enabled — this entry is paused.</p>
        )}
      </div>
    </div>
  );
}

function majorApproach(
  control: Scene['world']['control'],
  j: Scene['junctions'][number],
): number {
  let major = j.approaches[0];
  for (const ap of j.approaches) {
    if (control.rank[ap.conns[0]] > control.rank[major.conns[0]]) major = ap;
  }
  return major.fromLane;
}

function ComparePanel({
  snapA,
  snapB,
  onCapture,
}: {
  snapA: Stats | null;
  snapB: Stats | null;
  onCapture: (slot: 'A' | 'B') => void;
}) {
  const box = 'rounded-xl border border-white/10 bg-neutral-900/60 p-4';
  const rows: { label: string; get: (s: Stats) => string }[] = [
    { label: 'Cars in network', get: (s) => String(s.cars) },
    { label: 'Avg speed', get: (s) => `${s.avgSpeedKmh.toFixed(0)} km/h` },
    { label: 'Trips completed', get: (s) => String(s.completedTrips) },
    { label: 'Avg trip time', get: (s) => (s.avgTravelTime ? `${s.avgTravelTime.toFixed(0)} s` : '—') },
    { label: 'Sim time', get: (s) => `${s.time.toFixed(0)} s` },
  ];
  const interval =
    snapA && snapB && snapB.time > snapA.time
      ? ((snapB.completedTrips - snapA.completedTrips) / (snapB.time - snapA.time)) * 60
      : null;

  return (
    <div className={`${box} text-sm`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-neutral-200">Compare A / B</h3>
        <div className="flex gap-2">
          <button
            onClick={() => onCapture('A')}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
          >
            Capture A
          </button>
          <button
            onClick={() => onCapture('B')}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
          >
            Capture B
          </button>
        </div>
      </div>
      <table className="w-full tabular-nums">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="pb-1 font-normal">Metric</th>
            <th className="pb-1 text-right font-normal">A</th>
            <th className="pb-1 text-right font-normal">B</th>
          </tr>
        </thead>
        <tbody className="text-neutral-300">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-white/5">
              <td className="py-1 text-neutral-400">{r.label}</td>
              <td className="py-1 text-right">{snapA ? r.get(snapA) : '—'}</td>
              <td className="py-1 text-right">{snapB ? r.get(snapB) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {interval !== null ? (
        <p className="mt-3 text-xs text-emerald-400">
          Between A→B: {(snapB!.completedTrips - snapA!.completedTrips)} trips in{' '}
          {(snapB!.time - snapA!.time).toFixed(0)}s = <b>{interval.toFixed(1)} trips/min</b>.
        </p>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">
          Capture A, change the scenario, let it settle, then capture B to compare throughput.
        </p>
      )}
    </div>
  );
}
