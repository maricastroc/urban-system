import { buildLaneGraph, createWorld, type World } from '@/engine';
import type { LaneGeometry } from './geometry';

const LANE_LENGTH = 220; // metres
const SPEED_LIMIT = 16; // m/s (~58 km/h)
const CAPACITY = 48;
const SEED = 0x9e3779b9;

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
  readonly laneLength: number;
}

/**
 * Build a single straight-lane scene driven by demand at `rate` cars/second. The scene starts
 * empty: the engine's FASE 0 admits cars over time and FASE 3 despawns them at the end. All
 * population is owned by the engine now — no render-side harness.
 */
export function createScene(rate: number): Scene {
  const graph = buildLaneGraph([
    { length: LANE_LENGTH, speedLimit: SPEED_LIMIT, fromNode: 0, toNode: 1 },
  ]);
  const world = createWorld(graph, CAPACITY, undefined, SEED);
  world.demand.push({ lane: 0, rate });
  const geometry: LaneGeometry = { a: [{ x: 0, y: 0 }], b: [{ x: LANE_LENGTH, y: 0 }] };
  return { world, geometry, laneLength: LANE_LENGTH };
}

/** Tune the demand rate (cars/second) live, without rebuilding the scene. */
export function setDemandRate(scene: Scene, rate: number): void {
  const src = scene.world.demand[0];
  if (src) src.rate = rate;
}
