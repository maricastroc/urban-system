import { createAgentStore, type AgentStore } from './agents';
import { createLaneOccupancy, type LaneOccupancy } from './laneList';
import { DT, DEFAULT_VPARAMS } from './constants';
import type { LaneGraph } from './laneGraph';
import type { LaneId, VParams } from './types';

/** A demand source: vehicles arrive at `lane`'s start at a mean of `rate` per second. */
export interface SpawnSource {
  readonly lane: LaneId;
  rate: number; // mutable so demand can be tuned live
  readonly speed?: number; // entry speed (m/s); defaults to 0
}

/** Running totals accumulated as trips complete. */
export interface SimMetrics {
  completedTrips: number;
  totalTravelTime: number; // seconds, summed over completed trips
}

/**
 * The complete mutable simulation state (design doc §F).
 *
 * Plain data only — the static graph, the SoA agent store, the dynamic per-lane occupancy, the
 * vehicle catalog, demand + PRNG state, metric accumulators, and scalar counters. No methods,
 * so the whole World can later be moved across a Worker boundary without reshaping.
 */
export interface World {
  readonly graph: LaneGraph; // static network
  readonly agents: AgentStore; // SoA agent state
  readonly occ: LaneOccupancy; // dynamic per-lane occupancy
  readonly vparams: readonly VParams[]; // vehicle catalog, indexed by an agent's `type`
  readonly dt: number; // fixed timestep (s)
  demand: SpawnSource[]; // spawn configuration (FASE 0), tunable live
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
    vparams,
    dt: DT,
    demand: [],
    metrics: { completedTrips: 0, totalTravelTime: 0 },
    rngState: seed | 0,
    time: 0,
    tickCount: 0,
  };
}
