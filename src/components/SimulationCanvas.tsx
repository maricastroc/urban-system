'use client';

import 'react-tooltip/dist/react-tooltip.css';
import { Tooltip } from 'react-tooltip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick } from '@/engine';
import { createScene, setDemandRate, captureConfig, scenarioSignature, toggleSignal, type Scene } from '@/render/scene';
import { type SimClient } from './sim/simClient';
import { encodeScenario, decodeScenario, applyScenario, SCENARIO_PARAM } from '@/render/shareLink';
import { type Preset, type NetworkPreset, PRESETS, DEFAULT_NETWORK, SHOWCASE_NETWORK, capacityForGrid, centralJunction } from '@/render/presets';
import { type RenderCar } from '@/render/renderer';
import { useSimLoop, type SimLoopRefs } from './sim/useSimLoop';
import { useSimEngine } from './sim/useSimEngine';
import { useExperiments } from './sim/useExperiments';
import { runExperimentPool } from './sim/experimentPool';
import {
  computeSelStats,
  compassLabels,
  scenarioChanged,
  unitsToRate,
  NONE_SEL,
  type Selection,
  type SelStats,
} from './sim/types';
import { WARMUP_TICKS } from './sim/simProtocol';
import { TopBar } from './sim/TopBar';
import { Telemetry } from './sim/Telemetry';
import { type SparkHandle } from './sim/Sparkline';
import { ControlDock } from './sim/ControlDock';
import { Presets } from './sim/Presets';
import { NetworkPresets } from './sim/NetworkPresets';
import { Coach } from './sim/Coach';
import { Inspector } from './sim/Inspector';
import { Experiment } from './sim/Experiment';
import { Optimizer } from './sim/Optimizer';
import { WorkflowStep, PhaseLabel } from './sim/ui';
import { hitTest } from './sim/hitTest';

const DEFAULT_DEMAND = 4;
/** The guided onboarding demo (§31) coordinates the central corridor — the wave
 *  preset (demand tuned so the coordination clearly wins) — and measures it at a
 *  full 5-minute A/B, which fully credits the wave (§25). */
const WAVE_PRESET: Preset = PRESETS.find((p) => p.id === 'wave')!;
const DEMO_TICKS = 1500;
const relPct = (a: number, b: number) => (a ? ((b - a) / Math.abs(a)) * 100 : 0);

function buildInitialScene(
  scenarioParam: string | null | undefined,
  grid: number | null,
  cap: number | null,
): Scene {
  const scene = pickInitialScene(scenarioParam, grid, cap);
  for (let i = 0; i < WARMUP_TICKS; i++) tick(scene.world);
  return scene;
}

function pickInitialScene(
  scenarioParam: string | null | undefined,
  grid: number | null,
  cap: number | null,
): Scene {

  if (grid != null && grid >= 2) {
    const g = Math.floor(grid);
    return createScene(unitsToRate(DEFAULT_DEMAND), {
      grid: g,
      capacity: cap != null && cap > 0 ? Math.floor(cap) : capacityForGrid(g),
    });
  }

  const parsed = scenarioParam ? decodeScenario(scenarioParam) : null;
  if (parsed) {
    const scene = createScene(unitsToRate(DEFAULT_DEMAND), {
      grid: parsed.grid,
      capacity: capacityForGrid(parsed.grid),
    });
    applyScenario(scene, parsed);
    return scene;
  }
  return createScene(DEFAULT_NETWORK.demandRate, {
    grid: DEFAULT_NETWORK.grid,
    capacity: DEFAULT_NETWORK.capacity,
  });
}

function demandUnitsOf(scene: Scene): number {
  return Math.round(Math.max(0, ...scene.sources.map((s) => s.rate)) * 10);
}

export function SimulationCanvas({
  scenarioParam = null,
  debug = false,
  grid = null,
  cap = null,
  worker = false,
}: {
  scenarioParam?: string | null;
  debug?: boolean;
  grid?: number | null;
  cap?: number | null;
  worker?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const simClientRef = useRef<SimClient | null>(null);
  const stagePendingRef = useRef(false);


  const [scene, setSceneState] = useState<Scene>(() => buildInitialScene(scenarioParam, grid, cap));
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
  const [demand, setDemand] = useState(() => demandUnitsOf(scene));
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [selStats, setSelStats] = useState<SelStats | null>(null);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [coachDismissed, setCoachDismissed] = useState(!!scenarioParam);
  const [demoStarted, setDemoStarted] = useState(false);
  const [demoContrastPct, setDemoContrastPct] = useState(0);
  const [shared, setShared] = useState(false);

  const [network, setNetwork] = useState(() => ({
    grid: scene.grid,
    capacity: scene.world.agents.capacity,
  }));
  const demandSkip = useRef(true);

  const perfRef = useRef({ tick: 0, draw: 0, fps: 0, lastPaint: 0 });
  const perfBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    playingRef.current = playing;
    simClientRef.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
    simClientRef.current?.setSpeed(speed);
  }, [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);
  useEffect(() => {
    if (demandSkip.current) {
      demandSkip.current = false;
      return;
    }
    const c = simClientRef.current;
    if (c) c.setDemand(unitsToRate(demand));
    else setDemandRate(sceneRef.current, unitsToRate(demand));
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
    const c = simClientRef.current;
    if (c) {
      c.setSelection(next);
      setSelStats(null);
    } else {
      setSelStats(next.kind === 'none' ? null : computeSelStats(sceneRef.current, next));
    }
  }, []);

  useEffect(() => {
    if (sel.kind === 'none') return;
    const id = window.setInterval(() => {
      const c = simClientRef.current;
      const st = c
        ? (c.selection()?.stats ?? null)
        : computeSelStats(sceneRef.current, selRef.current);

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

  const { mutate, actions } = useSimEngine(simClientRef, sceneRef, bump);

  const {
    expResult, expRunning, expDuration, setExpDuration, runExp, clearStaged,
    sweepRunning, sweepProg, sweepResult, runSweep, stageCandidate, isCandidateStaged,
    stagedNeedsRun, refoldSweepSig, resetExperiments,
  } = useExperiments({ sceneRef, simClientRef, stagePendingRef, stagedRef, mutate, bump });

  const reset = useCallback(() => {
    const fresh = createScene(unitsToRate(demand), { grid: network.grid, capacity: network.capacity });
    setSceneState(fresh);
    simClientRef.current?.reset({
      grid: network.grid,
      capacity: network.capacity,
      demand: unitsToRate(demand),
      speed: speedRef.current,
      playing: playingRef.current,
    });
    setSel(NONE_SEL);
    setSelStats(null);
    resetExperiments();
    clearShareUrl();
  }, [demand, clearShareUrl, network, resetExperiments]);

  const applyPreset = useCallback((preset: Preset) => {
    const staged = createScene(preset.demandRate, { grid: network.grid, capacity: network.capacity });
    preset.stage?.(staged);
    setSceneState(staged);
    simClientRef.current?.reset({
      grid: network.grid,
      capacity: network.capacity,
      demand: preset.demandRate,
      speed: speedRef.current,
      playing: playingRef.current,
      config: captureConfig(staged),
    });
    setDemand(Math.round(preset.demandRate * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    resetExperiments();
    setCoachDismissed(true);
    clearShareUrl();
  }, [clearShareUrl, network, resetExperiments]);

  const applyNetwork = useCallback((net: NetworkPreset) => {
    setNetwork({ grid: net.grid, capacity: net.capacity });
    const fresh = createScene(net.demandRate, { grid: net.grid, capacity: net.capacity });
    setSceneState(fresh);
    simClientRef.current?.reset({
      grid: net.grid,
      capacity: net.capacity,
      demand: net.demandRate,
      speed: speedRef.current,
      playing: playingRef.current,
    });
    setDemand(Math.round(net.demandRate * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    resetExperiments();
    setCoachDismissed(true);
    clearShareUrl();
  }, [clearShareUrl, resetExperiments]);

  const applyGuidedDemo = useCallback(() => {
    const dm = WAVE_PRESET.demandRate;
    const opts = { grid: network.grid, capacity: network.capacity };
    const staged = createScene(dm, opts);
    WAVE_PRESET.stage?.(staged);
    setSceneState(staged);
    simClientRef.current?.reset({
      grid: network.grid,
      capacity: network.capacity,
      demand: dm,
      speed: speedRef.current,
      playing: playingRef.current,
      config: captureConfig(staged),
    });
    setDemand(Math.round(dm * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    resetExperiments();
    setExpDuration(DEMO_TICKS);
    clearShareUrl();

    const solo = createScene(dm, opts);
    toggleSignal(solo, centralJunction(solo));
    setDemoStarted(true);
    runExperimentPool(captureConfig(solo), DEMO_TICKS).then((r) =>
      setDemoContrastPct(relPct(r.baseline.avgSpeedKmh, r.intervention.avgSpeedKmh)),
    );
  }, [network, clearShareUrl, resetExperiments, setExpDuration]);

  const share = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?${SCENARIO_PARAM}=${encodeScenario(sceneRef.current)}`;
    window.history.replaceState(null, '', url);
    void navigator.clipboard?.writeText(url).catch(() => {});
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  }, []);

  const pulseJunction = useCallback((j: number) => {
    stagedRef.current = { junction: j, at: performance.now() };
  }, []);

  const fastForward = useCallback(() => {
    const c = simClientRef.current;
    if (c) {
      c.fastForward(300);
      return;
    }
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

  const hitTestAt = useCallback((clientX: number, clientY: number): Selection => {
    const canvas = canvasRef.current;
    if (!canvas) return NONE_SEL;
    const rect = canvas.getBoundingClientRect();
    return hitTest(sceneRef.current, carsRef.current, rect, clientX - rect.left, clientY - rect.top);
  }, []);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent) => select(hitTestAt(e.clientX, e.clientY)),
    [hitTestAt, select],
  );
  const onCanvasMove = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestAt(e.clientX, e.clientY);
      hoverLaneRef.current = hit.kind === 'lane' ? hit.lane : -1;
      hoverJctRef.current = hit.kind === 'junction' ? hit.j : -1;
      const el = canvasRef.current;
      if (el) el.style.cursor = hit.kind === 'none' ? 'default' : 'pointer';
    },
    [hitTestAt],
  );
  const onCanvasLeave = useCallback(() => {
    hoverLaneRef.current = -1;
    hoverJctRef.current = -1;
  }, []);

  const loopRefs = useMemo<SimLoopRefs>(
    () => ({
      canvasRef, glCanvasRef, sceneRef, prevSRef, prevActiveRef, prevLaneRef, accRef, lastTsRef,
      playingRef, speedRef, selRef, hoverLaneRef, hoverJctRef, stagedRef, carsRef, simClientRef,
      stagePendingRef, hudCars, hudFlow, hudSpeed, hudTrips, hudClock, dispRef, flowRef, sampleRef,
      flowSparkRef, speedSparkRef, perfRef, perfBoxRef,
    }),
    [],
  );
  useSimLoop({ worker, grid, cap, initialDemand: unitsToRate(DEFAULT_DEMAND), refs: loopRefs, bump, onStageConfirmed: refoldSweepSig });

  const sinkLabels = useMemo(() => compassLabels(scene.sinks.map((l) => scene.geometry.b[l])), [scene]);
  const sinkLabelOf = useCallback(
    (sink: number) => {
      const i = scene.sinks.indexOf(sink);
      return i >= 0 ? sinkLabels[i] : `#${sink}`;
    },
    [scene, sinkLabels],
  );

  const changed = scenarioChanged(scene);
  const sweepStale =
    !!sweepResult && (scenarioSignature(scene) !== sweepResult.sig || expDuration !== sweepResult.duration);
  const coachStep = !demoStarted ? 0 : !expResult ? 1 : 2;
  const waveResult = expResult
    ? {
        speedPct: relPct(expResult.baseline.avgSpeedKmh, expResult.intervention.avgSpeedKmh),
        tripsPct: relPct(expResult.baseline.completedTrips, expResult.intervention.completedTrips),
      }
    : null;

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
        <div className="anim-fade relative h-[56dvh] min-h-0 shrink-0 lg:h-auto lg:flex-1">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={onCanvasLeave}
            className="absolute inset-0 h-full w-full cursor-pointer"
          />
          <canvas ref={glCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

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

          {!coachDismissed && (
            <Coach
              step={coachStep}
              running={expRunning}
              waveResult={waveResult}
              singleSignalSpeedPct={demoContrastPct}
              demoDemand={WAVE_PRESET.demandRate}
              demoMinutes={Math.round(DEMO_TICKS / 300)}
              onStart={applyGuidedDemo}
              onRunAB={runExp}
              onEnterMetro={() => applyNetwork(SHOWCASE_NETWORK)}
              onDismiss={() => setCoachDismissed(true)}
            />
          )}

          {debug && (
            <div
              ref={perfBoxRef}
              className="pointer-events-none absolute left-3 top-3 z-30 rounded-md border border-(--border) bg-black/70 px-2.5 py-1 font-mono text-[11px] tabular-nums text-(--text-2)"
            />
          )}
        </div>

        <aside className="thin-scroll flex w-full shrink-0 flex-col gap-3 border-t border-(--border) p-3 lg:min-h-0 lg:w-92 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <NetworkPresets activeGrid={network.grid} onApply={applyNetwork} />

          {/* Observe → Intervene → Measure → Optimize: the panel reads as one loop.
              Observe is the continuous, passive phase (watch the live city); the
              numbered steps below are the acting sequence. */}
          <PhaseLabel>Observe</PhaseLabel>
          <Inspector scene={scene} sel={sel} stats={selStats} actions={actions} onClear={() => select(NONE_SEL)} sinkLabelOf={sinkLabelOf} pulseJunction={pulseJunction} />
          <Telemetry flowSpark={flowSparkRef} speedSpark={speedSparkRef} freeKmh={freeKmh} />

          {/* The experimentation workflow, threaded as ordered steps. */}
          <div className="flex flex-col">
            <WorkflowStep n={1} phase="Intervene" first>
              <Presets onApply={applyPreset} />
            </WorkflowStep>
            <WorkflowStep n={2} phase="Measure">
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
            <WorkflowStep n={3} phase="Optimize" last>
              <Optimizer
                running={sweepRunning}
                done={sweepProg.done}
                total={sweepProg.total}
                result={sweepResult}
                duration={expDuration}
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
