import { createAgentStore, type AgentStore } from './agents';
import { createLaneOccupancy, type LaneOccupancy } from './laneList';
import { createControl, type ScenarioControl } from './control';
import { DT, DEFAULT_VPARAMS } from './constants';
import type { LaneGraph } from './laneGraph';
import type { LaneId, VParams } from './types';

/** A slice [start, end) into the world's routeBuffer, describing one precomputed route. */
export interface RouteRef {
  readonly start: number;
  readonly end: number;
}

/** A demand source: vehicles arrive at `lane`'s start at a mean of `rate` per second. */
export interface SpawnSource {
  readonly lane: LaneId;
  rate: number; // mutable so demand can be tuned live
  readonly speed?: number; // entry speed (m/s); defaults to 0
  routes?: readonly RouteRef[]; // candidate routes, re-pointable live (destinations / detours)
}

/** Running totals accumulated as trips complete. */
export interface SimMetrics {
  completedTrips: number;
  totalTravelTime: number; // seconds, summed over completed trips
}

/**
 * The complete mutable simulation state (design doc §F).
 *
 * Plain data — the static graph, the SoA agent store, per-lane occupancy, the vehicle catalog,
 * demand + PRNG state, the shared route buffer, metric accumulators, and scalar counters.
 */
export interface World {
  readonly graph: LaneGraph;
  readonly agents: AgentStore;
  readonly occ: LaneOccupancy;
  readonly control: ScenarioControl; // live experiment overlay (closures, incidents, signals, priority)
  readonly vparams: readonly VParams[];
  readonly dt: number;
  demand: SpawnSource[]; // spawn configuration (FASE 0), tunable live
  routeBuffer: number[]; // append-only lane sequences; agents index slices of this
  metrics: SimMetrics; // running totals, recorded at despawn (FASE 3)
  rngState: number; // deterministic PRNG state
  time: number; // elapsed sim time (s)
  tickCount: number; // number of ticks executed
}

export function createWorld(
  graph: LaneGraph,
  capacity: number,
  vparams: readonly VParams[] = DEFAULT_VPARAMS,
  seed = 1,
): World {
  return {
    graph,
    agents: createAgentStore(capacity),
    occ: createLaneOccupancy(graph.laneCount),
    control: createControl(graph),
    vparams,
    dt: DT,
    demand: [],
    routeBuffer: [],
    metrics: { completedTrips: 0, totalTravelTime: 0 },
    rngState: seed | 0,
    time: 0,
    tickCount: 0,
  };
}
