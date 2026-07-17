import {
  createWorld,
  computeRoute,
  addRoute,
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
  readonly reachable: number[]; // sinks reachable in the open network
  rate: number;
  allowed: Set<number>; // enabled destinations, a subset of `reachable`
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

// Routes append to the shared buffer (append-only), so in-flight cars keep their existing slices.
export function applyRoutes(scene: Scene): void {
  const { world } = scene;
  const closed = world.control.laneClosed;
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
