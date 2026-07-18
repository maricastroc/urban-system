'use client';

import 'react-tooltip/dist/react-tooltip.css';
import { Tooltip } from 'react-tooltip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick } from '@/engine';
import { createScene, setDemandRate, sampleStats, runExperiment, clearInterventions, scenarioSignature, type Scene, type ExperimentResult, type Stats } from '@/render/scene';
import { encodeScenario, decodeScenario, applyScenario, SCENARIO_PARAM } from '@/render/shareLink';
import { type Preset } from '@/render/presets';
import { generateCandidates, sweepBaseline, sweepCandidate, type SweepRow, type Candidate } from '@/render/optimize';
import { carRoute, isSelectedCarLive } from '@/render/carTrace';
import { fitCamera, project, unproject, nearestLane, placementAt } from '@/render/geometry';
import { drawScene, type RenderCar, type RenderOverlay } from '@/render/renderer';
import {
  computeSelStats,
  compassLabels,
  scenarioChanged,
  unitsToRate,
  NONE_SEL,
  type Selection,
  type SelStats,
} from './sim/types';
import { TopBar } from './sim/TopBar';
import { Telemetry } from './sim/Telemetry';
import { type SparkHandle } from './sim/Sparkline';
import { ControlDock } from './sim/ControlDock';
import { Presets } from './sim/Presets';
import { Coach } from './sim/Coach';
import { Inspector } from './sim/Inspector';
import { Experiment } from './sim/Experiment';
import { Optimizer } from './sim/Optimizer';
import { WorkflowStep } from './sim/ui';

const SIM_DT = 0.2;
const MAX_STEPS = 5;
const SAMPLE_DT = 1.0;
const DEFAULT_DEMAND = 4;

const fmtClock = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const LANE_TOL_M = 7;
const JUNCTION_TOL_PX = 15;
const CAR_TOL_PX = 11;
const JUNCTION_BIAS_PX = 4;
const EMPTY_ROUTE: number[] = [];
const SWEEP_TICKS = 300;
const SWEEP_CHUNK = 2;

function buildInitialScene(scenarioParam: string | null | undefined): Scene {
  const scene = createScene(unitsToRate(DEFAULT_DEMAND));
  const parsed = scenarioParam ? decodeScenario(scenarioParam) : null;
  if (parsed) applyScenario(scene, parsed);
  return scene;
}

function demandUnitsOf(scene: Scene): number {
  return Math.round(Math.max(0, ...scene.sources.map((s) => s.rate)) * 10);
}

export function SimulationCanvas({ scenarioParam = null }: { scenarioParam?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);


  const initialScene = useRef<Scene | null>(null);
  if (initialScene.current === null) initialScene.current = buildInitialScene(scenarioParam);

  const [scene, setSceneState] = useState<Scene>(initialScene.current);
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
  const stagedRef = useRef({ junction: -1, at: 0 });
  const carsRef = useRef<RenderCar[]>([]);

  const hudCars = useRef<HTMLSpanElement>(null);
  const hudFlow = useRef<HTMLSpanElement>(null);
  const hudSpeed = useRef<HTMLSpanElement>(null);
  const hudTrips = useRef<HTMLSpanElement>(null);
  const hudClock = useRef<HTMLSpanElement>(null);
  const dispRef = useRef({ cars: 0, flow: 0, speed: 0 });
  const flowRef = useRef({ t: 0, trips: 0, val: 0 });

  const flowSparkRef = useRef<SparkHandle>(null);
  const speedSparkRef = useRef<SparkHandle>(null);
  const sampleRef = useRef({ t: 0, trips: 0 });
  const freeKmh = useMemo(
    () => scene.world.graph.speedLimit[0] * scene.world.vparams[0].v0Factor * 3.6,
    [scene],
  );

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(() => demandUnitsOf(initialScene.current!));
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [selStats, setSelStats] = useState<SelStats | null>(null);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [expResult, setExpResult] = useState<ExperimentResult | null>(null);
  const [expRunning, setExpRunning] = useState(false);
  const [expDuration, setExpDuration] = useState(600);
  const [coachDismissed, setCoachDismissed] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepProg, setSweepProg] = useState({ done: 0, total: 0 });
  const [sweepResult, setSweepResult] = useState<{ baseline: Stats; rows: SweepRow[]; sig: string } | null>(null);
  const [shared, setShared] = useState(false);
  const [stagedNeedsRun, setStagedNeedsRun] = useState(false);
  const demandSkip = useRef(true);

  useEffect(() => void (playingRef.current = playing), [playing]);
  useEffect(() => void (speedRef.current = speed), [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);
  useEffect(() => {
    if (demandSkip.current) {
      demandSkip.current = false;
      return;
    }
    setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

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
    sampleRef.current = { t: 0, trips: 0 };
    flowSparkRef.current?.reset();
    speedSparkRef.current?.reset();
  }, [scene]);

  const select = useCallback((next: Selection) => {
    setSel(next);
    setSelStats(next.kind === 'none' ? null : computeSelStats(sceneRef.current, next));
  }, []);

  useEffect(() => {
    if (sel.kind === 'none') return;
    const id = window.setInterval(() => {
      const st = computeSelStats(sceneRef.current, selRef.current);
      if (st === null && selRef.current.kind === 'car') {
        setSel(NONE_SEL);
        setSelStats(null);
      } else {
        setSelStats(st);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [sel]);

  const clearShareUrl = useCallback(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const reset = useCallback(() => {
    setSceneState(createScene(unitsToRate(demand)));
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
    clearShareUrl();
  }, [demand, clearShareUrl]);

  const applyPreset = useCallback((preset: Preset) => {
    const staged = createScene(preset.demandRate);
    preset.stage?.(staged);
    setSceneState(staged);
    setDemand(Math.round(preset.demandRate * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
    clearShareUrl();
  }, [clearShareUrl]);

  const share = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?${SCENARIO_PARAM}=${encodeScenario(sceneRef.current)}`;
    window.history.replaceState(null, '', url);
    void navigator.clipboard?.writeText(url).catch(() => {});
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  }, []);

  const runExp = useCallback(() => {
    setExpRunning(true);
    setStagedNeedsRun(false);
    window.setTimeout(() => {
      setExpResult(runExperiment(sceneRef.current, expDuration));
      setExpRunning(false);
    }, 30);
  }, [expDuration]);

  const clearStaged = useCallback(() => {
    clearInterventions(sceneRef.current);
    setExpResult(null);
    setStagedNeedsRun(false);
    bump();
  }, [bump]);

  const runSweep = useCallback(() => {
    const scene = sceneRef.current;
    const candidates = generateCandidates(scene);
    const sig = scenarioSignature(scene);
    setSweepRunning(true);
    setSweepResult(null);
    setSweepProg({ done: 0, total: candidates.length });
    window.setTimeout(() => {
      const base = sweepBaseline(scene, SWEEP_TICKS);
      const rows: SweepRow[] = [];
      let i = 0;
      const step = () => {
        const end = Math.min(i + SWEEP_CHUNK, candidates.length);
        for (; i < end; i++) rows.push(sweepCandidate(base, candidates[i], SWEEP_TICKS));
        setSweepProg({ done: i, total: candidates.length });
        if (i < candidates.length) {
          window.setTimeout(step, 0);
        } else {
          rows.sort((a, b) => b.tripsDelta - a.tripsDelta || b.speedDelta - a.speedDelta);
          setSweepResult({ baseline: base.stats, rows, sig });
          setSweepRunning(false);
        }
      };
      step();
    }, 30);
  }, []);

  const stageCandidate = useCallback(
    (c: Candidate) => {
      c.apply(sceneRef.current);
      stagedRef.current = { junction: c.junction, at: performance.now() };
      select({ kind: 'junction', j: c.junction });
      setSweepResult((r) => (r ? { ...r, sig: scenarioSignature(sceneRef.current) } : r));
      setStagedNeedsRun(true);
      bump();
    },
    [select, bump],
  );

  const pulseJunction = useCallback((j: number) => {
    stagedRef.current = { junction: j, at: performance.now() };
  }, []);

  const isCandidateStaged = useCallback((c: Candidate) => {
    const scene = sceneRef.current;
    if (c.kind === 'signal') return scene.signals[c.junction]?.enabled === true;
    const { rank } = scene.world.control;
    const conns = scene.world.graph.connections;
    return scene.junctions[c.junction].approaches.some((ap) =>
      ap.conns.some((ci) => rank[ci] !== conns[ci].rank),
    );
  }, []);

  const fastForward = useCallback(() => {
    const world = sceneRef.current.world;
    for (let i = 0; i < 300; i++) tick(world);
    prevSRef.current.set(world.agents.s);
    prevActiveRef.current.set(world.agents.active);
    prevLaneRef.current.set(world.agents.lane);
    accRef.current = 0;
    lastTsRef.current = 0;
    flowRef.current = { t: world.time, trips: world.metrics.completedTrips, val: 0 };
    sampleRef.current = { t: world.time, trips: world.metrics.completedTrips };
  }, []);

  const hitTest = useCallback((clientX: number, clientY: number): Selection => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return NONE_SEL;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cam = fitCamera(scene.geometry, rect.width, rect.height);

    let bestCar = -1;
    let bestKey = 0;
    let bestCarD = CAR_TOL_PX;
    for (const c of carsRef.current) {
      const p = placementAt(scene.geometry, c.lane, c.s);
      const sp = project(cam, p.x, p.y);
      const d = Math.hypot(sp.x - px, sp.y - py);
      if (d < bestCarD) {
        bestCarD = d;
        bestCar = c.id;
        bestKey = c.key;
      }
    }

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

    if (bestJ >= 0 && (bestCar < 0 || bestJD <= bestCarD + JUNCTION_BIAS_PX)) {
      return { kind: 'junction', j: bestJ };
    }
    if (bestCar >= 0) return { kind: 'car', id: bestCar, key: bestKey };

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
        cars.push({ id, key: agents.enterTime[id], lane, s, length: world.vparams[agents.type[id]].length, speedFrac: agents.v[id] / v0 });
      }
      carsRef.current = cars;

      const cur = selRef.current;
      let selCar = -1;
      let carRouteLanes: readonly number[] = EMPTY_ROUTE;
      let carRouteI = -1;
      if (cur.kind === 'car' && isSelectedCarLive(world, cur.id, cur.key)) {
        selCar = cur.id;
        const r = carRoute(world, cur.id);
        if (r) {
          carRouteLanes = r.lanes;
          carRouteI = r.idx;
        }
      }
      const overlay: RenderOverlay = {
        selectedLane: cur.kind === 'lane' ? cur.lane : -1,
        hoverLane: hoverLaneRef.current,
        selectedJunction: cur.kind === 'junction' ? cur.j : -1,
        hoverJunction: hoverJctRef.current,
        selectedCar: selCar,
        carRoute: carRouteLanes,
        carRouteIdx: carRouteI,
        now: ts,
        stagedJunction: stagedRef.current.junction,
        stagedAt: stagedRef.current.at,
      };
      drawScene(ctx, canvas.clientWidth, canvas.clientHeight, scene, cars, overlay);

      const st = sampleStats(world);
      const f = flowRef.current;
      if (world.time - f.t >= 1.5) {
        f.val = ((world.metrics.completedTrips - f.trips) / (world.time - f.t)) * 60;
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
      if (hudClock.current) hudClock.current.textContent = fmtClock(world.time);

      const smp = sampleRef.current;
      const dtS = world.time - smp.t;
      if (dtS >= SAMPLE_DT) {
        flowSparkRef.current?.push(((world.metrics.completedTrips - smp.trips) / dtS) * 60);
        speedSparkRef.current?.push(st.avgSpeedKmh);
        smp.t = world.time;
        smp.trips = world.metrics.completedTrips;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const sinkLabels = useMemo(() => compassLabels(scene.sinks.map((l) => scene.geometry.b[l])), [scene]);
  const sinkLabelOf = useCallback(
    (sink: number) => {
      const i = scene.sinks.indexOf(sink);
      return i >= 0 ? sinkLabels[i] : `#${sink}`;
    },
    [scene, sinkLabels],
  );

  const changed = scenarioChanged(scene);
  const sweepStale = !!sweepResult && scenarioSignature(scene) !== sweepResult.sig;
  const coachStep = !changed ? 0 : !expResult ? 1 : 2;

  return (
    <div className="flex min-h-dvh flex-col bg-(--bg) text-(--text-1) lg:h-dvh">
      <TopBar
        playing={playing}
        hudCars={hudCars}
        hudFlow={hudFlow}
        hudSpeed={hudSpeed}
        hudTrips={hudTrips}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[56dvh] min-h-0 shrink-0 lg:h-auto lg:flex-1">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={onCanvasLeave}
            className="absolute inset-0 h-full w-full cursor-pointer"
          />

          <ControlDock
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeed={setSpeed}
            demand={demand}
            onDemand={setDemand}
            onReset={reset}
            onFastForward={fastForward}
            onShare={share}
            shared={shared}
            clockRef={hudClock}
          />

          {!coachDismissed && coachStep < 2 && <Coach step={coachStep} onDismiss={() => setCoachDismissed(true)} />}
        </div>

        <aside className="thin-scroll flex w-full shrink-0 flex-col gap-3 border-t border-(--border) p-3 lg:min-h-0 lg:w-92 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <Inspector scene={scene} sel={sel} stats={selStats} bump={bump} onClear={() => select(NONE_SEL)} sinkLabelOf={sinkLabelOf} pulseJunction={pulseJunction} />
          <Telemetry flowSpark={flowSparkRef} speedSpark={speedSparkRef} freeKmh={freeKmh} />

          {/* The experimentation workflow, threaded as ordered steps. */}
          <div className="flex flex-col">
            <WorkflowStep n={1} first>
              <Presets onApply={applyPreset} />
            </WorkflowStep>
            <WorkflowStep n={2}>
              <Experiment
                result={expResult}
                running={expRunning}
                duration={expDuration}
                onDuration={setExpDuration}
                onRun={runExp}
                onClearStaged={clearStaged}
                hasIntervention={changed}
                highlight={stagedNeedsRun || (!coachDismissed && coachStep === 1)}
              />
            </WorkflowStep>
            <WorkflowStep n={3} last>
              <Optimizer
                running={sweepRunning}
                done={sweepProg.done}
                total={sweepProg.total}
                result={sweepResult}
                onRun={runSweep}
                onStage={stageCandidate}
                isStaged={isCandidateStaged}
                stale={sweepStale}
              />
            </WorkflowStep>
          </div>
        </aside>
      </div>

      <Tooltip id="uf-tip" className="uf-tooltip" classNameArrow="uf-tooltip-arrow" place="top" />
    </div>
  );
}
