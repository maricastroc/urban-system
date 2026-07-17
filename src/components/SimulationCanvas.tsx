'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick } from '@/engine';
import { createScene, setDemandRate, sampleStats, runExperiment, type Scene, type ExperimentResult } from '@/render/scene';
import { fitCamera, project, unproject, nearestLane } from '@/render/geometry';
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
import { type SparkHandle } from './sim/Sparkline';
import { ControlDock } from './sim/ControlDock';
import { Coach } from './sim/Coach';
import { Inspector } from './sim/Inspector';
import { Experiment } from './sim/Experiment';

const SIM_DT = 0.2;
const MAX_STEPS = 5;
const SAMPLE_DT = 1.0; // sim-seconds between sparkline samples
const DEFAULT_DEMAND = 4;
const LANE_TOL_M = 7;
const JUNCTION_TOL_PX = 15;

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

  // Live HUD readouts update imperatively each frame (refs + tween) to avoid 60fps React renders.
  const hudCars = useRef<HTMLSpanElement>(null);
  const hudFlow = useRef<HTMLSpanElement>(null);
  const hudSpeed = useRef<HTMLSpanElement>(null);
  const hudTrips = useRef<HTMLSpanElement>(null);
  const dispRef = useRef({ cars: 0, flow: 0, speed: 0 });
  const flowRef = useRef({ t: 0, trips: 0, val: 0 });

  // Rolling metric sparklines: sampled on sim-time (SAMPLE_DT) so the window is a
  // fixed 60s regardless of playback speed; updated imperatively via handles.
  const flowSparkRef = useRef<SparkHandle>(null);
  const speedSparkRef = useRef<SparkHandle>(null);
  const sampleRef = useRef({ t: 0, trips: 0 });
  const freeKmh = useMemo(
    () => scene.world.graph.speedLimit[0] * scene.world.vparams[0].v0Factor * 3.6,
    [scene],
  );

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(DEFAULT_DEMAND);
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [selStats, setSelStats] = useState<SelStats | null>(null);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [expResult, setExpResult] = useState<ExperimentResult | null>(null);
  const [expRunning, setExpRunning] = useState(false);
  const [expDuration, setExpDuration] = useState(600);
  const [coachDismissed, setCoachDismissed] = useState(false);

  useEffect(() => void (playingRef.current = playing), [playing]);
  useEffect(() => void (speedRef.current = speed), [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);
  useEffect(() => {
    setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

  // Keep the loop's scene pointer + interpolation buffers in sync with the (re)built scene.
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
    const id = window.setInterval(() => setSelStats(computeSelStats(sceneRef.current, selRef.current)), 200);
    return () => window.clearInterval(id);
  }, [sel]);

  const reset = useCallback(() => {
    setSceneState(createScene(unitsToRate(demand)));
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
  }, [demand]);

  const runExp = useCallback(() => {
    setExpRunning(true);
    window.setTimeout(() => {
      setExpResult(runExperiment(sceneRef.current, expDuration));
      setExpRunning(false);
    }, 30);
  }, [expDuration]);

  // Fast-forward the live sim by 60s of sim time, headless; then resync interpolation.
  const fastForward = useCallback(() => {
    const world = sceneRef.current.world;
    for (let i = 0; i < 300; i++) tick(world);
    prevSRef.current.set(world.agents.s);
    prevActiveRef.current.set(world.agents.active);
    prevLaneRef.current.set(world.agents.lane);
    accRef.current = 0;
    lastTsRef.current = 0;
    flowRef.current = { t: world.time, trips: world.metrics.completedTrips, val: 0 };
    // Rebase the sampler to the post-jump clock so the next sample isn't a 60s spike.
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

      // Feed the rolling sparklines once per SAMPLE_DT of sim-time (paused → no push).
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
  const coachStep = !changed ? 0 : !expResult ? 1 : 2;

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text-1)]">
      <TopBar
        playing={playing}
        hudCars={hudCars}
        hudFlow={hudFlow}
        hudSpeed={hudSpeed}
        hudTrips={hudTrips}
        flowSpark={flowSparkRef}
        speedSpark={speedSparkRef}
        freeKmh={freeKmh}
      />

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
            onFastForward={fastForward}
          />

          {!coachDismissed && coachStep < 2 && <Coach step={coachStep} onDismiss={() => setCoachDismissed(true)} />}
        </div>

        <aside className="thin-scroll flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-[var(--border)] p-3 lg:w-[368px] lg:border-l lg:border-t-0">
          <Inspector scene={scene} sel={sel} stats={selStats} bump={bump} onClear={() => select(NONE_SEL)} sinkLabelOf={sinkLabelOf} />
          <Experiment
            result={expResult}
            running={expRunning}
            duration={expDuration}
            onDuration={setExpDuration}
            onRun={runExp}
            hasIntervention={changed}
            highlight={!coachDismissed && coachStep === 1}
          />
        </aside>
      </div>
    </div>
  );
}
