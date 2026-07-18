import {
  createWorld,
  computeRoute,
  addRoute,
  tick,
  closeLane,
  openLane,
  setIncident as engineSetIncident,
  clearIncident as engineClearIncident,
  swapRanks,
  createSignal,
  addSignal,
  enableSignal,
  disableSignal,
  DEFAULT_SIGNAL_SECONDS,
  type World,
  type SpawnSource,
  type SignalController,
} from '@/engine';
import { buildGrid, type Junction } from './grid';
import type { LaneGeometry } from './geometry';

const CAPACITY = 256;
const SEED = 0x9e3779b9;
const GRID = 5;

export interface SourceCtl {
  readonly lane: number;
  readonly src: SpawnSource;
  readonly reachable: number[];
  rate: number;
  allowed: Set<number>;
}

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
  readonly junctions: Junction[];
  readonly sources: SourceCtl[];
  readonly sinks: number[];
  readonly signals: (SignalController | null)[];
}

export function createScene(rate: number): Scene {
  const { graph, geometry, sources, sinks, junctions } = buildGrid(GRID, GRID);
  const world = createWorld(graph, CAPACITY, undefined, SEED);

  const srcCtls: SourceCtl[] = [];
  for (const lane of sources) {
    const reachable = sinks.filter((sink) => {
      const path = computeRoute(graph, lane, sink);
      return path !== null && path.length > 1;
    });
    const src: SpawnSource = { lane, rate, routes: [] };
    world.demand.push(src);
    srcCtls.push({ lane, src, reachable, rate, allowed: new Set(reachable) });
  }

  const scene: Scene = {
    world,
    geometry,
    junctions,
    sources: srcCtls,
    sinks,
    signals: junctions.map(() => null),
  };
  applyRoutes(scene);
  return scene;
}

export function applyRoutes(scene: Scene): void {
  const { world } = scene;
  const { agents } = world;
  const closed = world.control.laneClosed;

  const oldBuffer = world.routeBuffer;
  const next: number[] = [];
  for (let id = 0; id < agents.capacity; id++) {
    if (agents.active[id] === 0) continue;
    const start = agents.routeStart[id];
    const end = agents.routeEnd[id];
    if (end <= start) continue;
    const base = next.length;
    for (let k = start; k < end; k++) next.push(oldBuffer[k]);
    agents.routeIdx[id] = base + (agents.routeIdx[id] - start);
    agents.routeStart[id] = base;
    agents.routeEnd[id] = next.length;
  }
  world.routeBuffer = next;

  for (const ctl of scene.sources) {
    const routes = [];
    for (const sink of ctl.allowed) {
      const path = computeRoute(world.graph, ctl.lane, sink, closed);
      if (path && path.length > 1) routes.push(addRoute(world, path));
    }
    ctl.src.routes = routes;
  }
}

export function setDemandRate(scene: Scene, rate: number): void {
  for (const ctl of scene.sources) setSourceRate(scene, ctl, rate);
}

export function setSourceRate(scene: Scene, ctl: SourceCtl, rate: number): void {
  ctl.rate = rate;
  ctl.src.rate = rate;
}

export function toggleDestination(scene: Scene, ctl: SourceCtl, sink: number): void {
  if (ctl.allowed.has(sink)) ctl.allowed.delete(sink);
  else ctl.allowed.add(sink);
  applyRoutes(scene);
}

export function toggleLaneClosed(scene: Scene, lane: number): boolean {
  const closed = scene.world.control.laneClosed[lane] === 1;
  if (closed) openLane(scene.world.control, lane);
  else closeLane(scene.world.control, lane);
  applyRoutes(scene);
  return !closed;
}

export function toggleIncident(scene: Scene, lane: number, s: number): boolean {
  const has = scene.world.control.incidentAt[lane] < Infinity;
  if (has) engineClearIncident(scene.world.control, lane);
  else engineSetIncident(scene.world.control, lane, s);
  return !has;
}

export function flipPriority(scene: Scene, j: number): void {
  const [h, v] = scene.junctions[j].approaches;
  swapRanks(scene.world.control, h.conns, v.conns);
}

export function toggleSignal(scene: Scene, j: number, seconds = DEFAULT_SIGNAL_SECONDS): boolean {
  const existing = scene.signals[j];
  if (existing && existing.enabled) {
    disableSignal(scene.world.control, existing);
    return false;
  }
  if (existing) {
    enableSignal(scene.world.control, existing);
    return true;
  }
  const [h, v] = scene.junctions[j].approaches;
  const sc = createSignal([h.conns, v.conns], [seconds, seconds]);
  scene.signals[j] = sc;
  addSignal(scene.world.control, sc);
  return true;
}

/**
 * A cheap string fingerprint of everything the optimizer's baseline depends on
 * (demand + closures + incidents + priority flips + signals). If it differs from
 * the value captured at sweep time, the shown results are stale.
 */
export function scenarioSignature(scene: Scene): string {
  const c = scene.world.control;
  const conns = scene.world.graph.connections;
  let closed = '';
  for (let i = 0; i < c.laneClosed.length; i++) if (c.laneClosed[i]) closed += `${i},`;
  let inc = '';
  for (let i = 0; i < c.incidentAt.length; i++) if (c.incidentAt[i] < Infinity) inc += `${i},`;
  let flips = '';
  for (let i = 0; i < c.rank.length; i++) if (c.rank[i] !== conns[i].rank) flips += `${i},`;
  const sig = scene.signals.map((s, j) => (s?.enabled ? j : '')).filter((x) => x !== '').join(',');
  const demand = scene.sources
    .map((s) => `${s.rate}:${[...s.allowed].sort((a, b) => a - b).join('.')}`)
    .join('|');
  return `C${closed}I${inc}F${flips}S${sig}D${demand}`;
}

export function clearInterventions(scene: Scene): void {
  const c = scene.world.control;
  const conns = scene.world.graph.connections;
  c.laneClosed.fill(0);
  c.incidentAt.fill(Infinity);
  for (let i = 0; i < c.rank.length; i++) c.rank[i] = conns[i].rank;
  for (const s of scene.signals) if (s && s.enabled) disableSignal(c, s);
  applyRoutes(scene);
}

export interface Stats {
  cars: number;
  avgSpeedKmh: number;
  completedTrips: number;
  avgTravelTime: number;
  time: number;
}

export function sampleStats(world: World): Stats {
  const { agents } = world;
  let sum = 0;
  let n = 0;
  for (let id = 0; id < agents.capacity; id++) {
    if (!agents.active[id]) continue;
    sum += agents.v[id];
    n += 1;
  }
  const m = world.metrics;
  return {
    cars: n,
    avgSpeedKmh: n ? (sum / n) * 3.6 : 0,
    completedTrips: m.completedTrips,
    avgTravelTime: m.completedTrips ? m.totalTravelTime / m.completedTrips : 0,
    time: world.time,
  };
}

export const EXPERIMENT_DURATIONS = [300, 600, 1500];

export interface ExperimentResult {
  readonly baseline: Stats;
  readonly intervention: Stats;
  readonly durationTicks: number;
  readonly changes: string[];
}

export interface ScenarioConfig {
  rates: number[];
  allowed: Set<number>[];
  laneClosed: Uint8Array;
  incidentAt: Float32Array;
  rank: Int32Array;
  signals: boolean[];
  closed: number;
  incidents: number;
  signalsOn: number;
  priorityFlips: number;
}

export function captureConfig(scene: Scene): ScenarioConfig {
  const c = scene.world.control;
  const conns = scene.world.graph.connections;
  let priorityFlips = 0;
  for (let i = 0; i < c.rank.length; i++) if (c.rank[i] !== conns[i].rank) priorityFlips += 1;
  let incidents = 0;
  for (let i = 0; i < c.incidentAt.length; i++) if (c.incidentAt[i] < Infinity) incidents += 1;
  let closed = 0;
  for (let i = 0; i < c.laneClosed.length; i++) closed += c.laneClosed[i];
  return {
    rates: scene.sources.map((s) => s.rate),
    allowed: scene.sources.map((s) => new Set(s.allowed)),
    laneClosed: c.laneClosed.slice(),
    incidentAt: c.incidentAt.slice(),
    rank: c.rank.slice(),
    signals: scene.signals.map((s) => s?.enabled === true),
    closed,
    incidents,
    signalsOn: scene.signals.reduce((n, s) => n + (s?.enabled ? 1 : 0), 0),
    priorityFlips,
  };
}

export function applyConfig(scene: Scene, cfg: ScenarioConfig, withIntervention: boolean): void {
  scene.sources.forEach((s, i) => {
    setSourceRate(scene, s, cfg.rates[i]);
    s.allowed = new Set(cfg.allowed[i]);
  });
  if (withIntervention) {
    scene.world.control.laneClosed.set(cfg.laneClosed);
    scene.world.control.incidentAt.set(cfg.incidentAt);
    scene.world.control.rank.set(cfg.rank);
    cfg.signals.forEach((on, j) => {
      if (on) toggleSignal(scene, j);
    });
  }
  applyRoutes(scene);
}

export function runExperiment(scene: Scene, durationTicks: number): ExperimentResult {
  const cfg = captureConfig(scene);

  const a = createScene(0);
  applyConfig(a, cfg, false);
  for (let n = 0; n < durationTicks; n++) tick(a.world);

  const b = createScene(0);
  applyConfig(b, cfg, true);
  for (let n = 0; n < durationTicks; n++) tick(b.world);

  const changes: string[] = [];
  if (cfg.closed) changes.push(`${cfg.closed} road${cfg.closed > 1 ? 's' : ''} closed`);
  if (cfg.incidents) changes.push(`${cfg.incidents} incident${cfg.incidents > 1 ? 's' : ''}`);
  if (cfg.signalsOn) changes.push(`${cfg.signalsOn} signalized`);
  if (cfg.priorityFlips) changes.push('priority changed');

  return { baseline: sampleStats(a.world), intervention: sampleStats(b.world), durationTicks, changes };
}
