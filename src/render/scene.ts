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
import { buildGrid, type Junction, type Corridor } from './grid';
import type { LaneGeometry } from './geometry';

export const DEFAULT_CAPACITY = 256;
export const DEFAULT_GRID = 5;
const SEED = 0x9e3779b9;

export interface SceneOptions {
  /** Grid dimension (rows = cols). Defaults to `DEFAULT_GRID`. */
  readonly grid?: number;
  /** Agent-store capacity. Defaults to `DEFAULT_CAPACITY`. */
  readonly capacity?: number;
}

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
  readonly corridors: Corridor[];
  /** Per-corridor green-wave cycle seconds, or 0 when the corridor is uncoordinated. */
  readonly coordinated: number[];
}

export function createScene(rate: number, opts: SceneOptions = {}): Scene {
  const grid = opts.grid ?? DEFAULT_GRID;
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const { graph, geometry, sources, sinks, junctions, corridors } = buildGrid(grid, grid);
  const world = createWorld(graph, capacity, undefined, SEED);

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
    corridors,
    coordinated: corridors.map(() => 0),
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
 * Green-wave a corridor (§25): signalize every junction along it and stagger
 * each one's phase `offset` by its cumulative travel time from the corridor's
 * upstream end, so a platoon at street speed rides a wave of greens. The
 * baseline network is pure priority give-way — there are no signals to
 * "coordinate", so this both *creates* the signals and phases them. Offsets are
 * derived from geometry + street speed, so the result is deterministic and
 * reproducible by the A/B and the optimizer.
 */
export function greenWave(scene: Scene, corridorIdx: number, seconds = DEFAULT_SIGNAL_SECONDS): void {
  const corridor = scene.corridors[corridorIdx];
  if (!corridor) return;
  scene.coordinated[corridorIdx] = seconds;

  const graph = scene.world.graph;
  const { junctions, axis } = corridor;
  const throughLane = scene.junctions[junctions[0]].approaches[axis === 'H' ? 0 : 1].fromLane;
  const speed = graph.speedLimit[throughLane] || 1;

  let dist = 0;
  for (let k = 0; k < junctions.length; k++) {
    if (k > 0) {
      const a = scene.junctions[junctions[k - 1]].pos;
      const b = scene.junctions[junctions[k]].pos;
      dist += Math.hypot(b.x - a.x, b.y - a.y);
    }

    setJunctionSignal(scene, junctions[k], seconds, -dist / speed);
  }
}

function setJunctionSignal(scene: Scene, j: number, seconds: number, offset: number): void {
  const existing = scene.signals[j];
  if (existing) disableSignal(scene.world.control, existing);
  const [h, v] = scene.junctions[j].approaches;
  const sc = createSignal([h.conns, v.conns], [seconds, seconds], offset);
  scene.signals[j] = sc;
  addSignal(scene.world.control, sc);
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
  let coord = '';
  for (let i = 0; i < scene.coordinated.length; i++) if (scene.coordinated[i] > 0) coord += `${i},`;
  const demand = scene.sources
    .map((s) => `${s.rate}:${[...s.allowed].sort((a, b) => a - b).join('.')}`)
    .join('|');
  return `C${closed}I${inc}F${flips}S${sig}W${coord}D${demand}`;
}

export function clearInterventions(scene: Scene): void {
  const c = scene.world.control;
  const conns = scene.world.graph.connections;
  c.laneClosed.fill(0);
  c.incidentAt.fill(Infinity);
  for (let i = 0; i < c.rank.length; i++) c.rank[i] = conns[i].rank;
  scene.coordinated.fill(0);
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
  /** Per-corridor green-wave cycle seconds (0 = uncoordinated). */
  coordinated: number[];
  closed: number;
  incidents: number;
  signalsOn: number;
  priorityFlips: number;
  coordinatedCount: number;
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

  const coordJct = new Set<number>();
  scene.coordinated.forEach((secs, i) => {
    if (secs > 0) for (const j of scene.corridors[i].junctions) coordJct.add(j);
  });
  return {
    rates: scene.sources.map((s) => s.rate),
    allowed: scene.sources.map((s) => new Set(s.allowed)),
    laneClosed: c.laneClosed.slice(),
    incidentAt: c.incidentAt.slice(),
    rank: c.rank.slice(),
    signals: scene.signals.map((s) => s?.enabled === true),
    coordinated: scene.coordinated.slice(),
    closed,
    incidents,
    signalsOn: scene.signals.reduce((n, s, j) => n + (s?.enabled && !coordJct.has(j) ? 1 : 0), 0),
    priorityFlips,
    coordinatedCount: scene.coordinated.reduce((n, s) => n + (s > 0 ? 1 : 0), 0),
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

    const coordinated = new Set<number>();
    cfg.coordinated.forEach((secs, i) => {
      if (secs > 0) {
        greenWave(scene, i, secs);
        for (const j of scene.corridors[i].junctions) coordinated.add(j);
      }
    });

    cfg.signals.forEach((on, j) => {
      if (on && !coordinated.has(j)) toggleSignal(scene, j);
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
  if (cfg.coordinatedCount) changes.push(`${cfg.coordinatedCount} green wave${cfg.coordinatedCount > 1 ? 's' : ''}`);
  if (cfg.priorityFlips) changes.push('priority changed');

  return { baseline: sampleStats(a.world), intervention: sampleStats(b.world), durationTicks, changes };
}
