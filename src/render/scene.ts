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
const GRID = 5; // rows == cols — a denser mesh reads as a system, not a diagram

/** Live per-entry demand configuration, sitting on top of the engine's SpawnSource. */
export interface SourceCtl {
  readonly lane: number;
  readonly src: SpawnSource; // the engine demand entry this controls
  readonly reachable: number[]; // sinks reachable in the open network (the menu of destinations)
  rate: number; // cars/second
  allowed: Set<number>; // enabled destinations (subset of `reachable`)
}

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
  readonly junctions: Junction[];
  readonly sources: SourceCtl[];
  readonly sinks: number[];
  readonly signals: (SignalController | null)[]; // per junction, created lazily
}

/**
 * A one-way Manhattan grid wired for live experimentation. Cars enter at the perimeter, are routed
 * (shortest path, detouring around closures) to one of their enabled destinations, and give way or
 * obey signals at each junction. Everything the control panel touches — demand, destinations,
 * closures, incidents, priority, signals — is applied through the helpers below, never by rebuilding.
 */
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
    const ctl: SourceCtl = { lane, src, reachable, rate, allowed: new Set(reachable) };
    srcCtls.push(ctl);
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

/**
 * Recompute every entry's candidate routes from its enabled destinations, detouring around any
 * closed lanes. Routes are appended to the shared buffer (append-only, so in-flight cars keep their
 * slices); each source is re-pointed at its fresh set. A source with no reachable destination is
 * left with an empty route list, which `spawn` treats as "drop the arrival".
 */
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

/** Tune every entry's inflow to the same rate (the global demand slider). */
export function setDemandRate(scene: Scene, rate: number): void {
  for (const ctl of scene.sources) setSourceRate(scene, ctl, rate);
}

/** Tune one entry's inflow. */
export function setSourceRate(scene: Scene, ctl: SourceCtl, rate: number): void {
  ctl.rate = rate;
  ctl.src.rate = rate;
}

/** Enable or disable a single destination for one entry, then re-route it. */
export function toggleDestination(scene: Scene, ctl: SourceCtl, sink: number): void {
  if (ctl.allowed.has(sink)) ctl.allowed.delete(sink);
  else ctl.allowed.add(sink);
  applyRoutes(scene);
}

/** Close or reopen a lane; new traffic reroutes around a closure, in-flight cars queue at it. */
export function toggleLaneClosed(scene: Scene, lane: number): boolean {
  const closed = scene.world.control.laneClosed[lane] === 1;
  if (closed) openLane(scene.world.control, lane);
  else closeLane(scene.world.control, lane);
  applyRoutes(scene); // closures change everyone's shortest paths
  return !closed;
}

/** Toggle a stopped incident at position `s` on a lane (no rerouting — it is a surprise). */
export function toggleIncident(scene: Scene, lane: number, s: number): boolean {
  const has = scene.world.control.incidentAt[lane] < Infinity;
  if (has) engineClearIncident(scene.world.control, lane);
  else engineSetIncident(scene.world.control, lane, s);
  return !has;
}

/** Flip which approach has priority at a junction (only meaningful while it is unsignalized). */
export function flipPriority(scene: Scene, j: number): void {
  const [h, v] = scene.junctions[j].approaches;
  swapRanks(scene.world.control, h.conns, v.conns);
}

/** Turn a junction's signals on (2-phase H/V) or off (back to priority give-way). */
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
  avgTravelTime: number; // seconds per completed trip
  time: number;
}

/** Read a snapshot of the live aggregate metrics (pure). */
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
