import { createAgentStore, type AgentStore } from './agents';
import { createLaneOccupancy, type LaneOccupancy } from './laneList';
import { DT, DEFAULT_VPARAMS } from './constants';
import type { LaneGraph } from './laneGraph';
import type { VParams } from './types';

/**
 * The complete mutable simulation state (design doc §F).
 *
 * Plain data only — the static graph, the SoA agent store, the dynamic per-lane occupancy,
 * the vehicle-parameter catalog, and two scalar counters. No methods, so the whole World
 * can later be moved across a Worker boundary without reshaping.
 */
export interface World {
  readonly graph: LaneGraph; // static network
  readonly agents: AgentStore; // SoA agent state
  readonly occ: LaneOccupancy; // dynamic per-lane occupancy
  readonly vparams: readonly VParams[]; // vehicle catalog, indexed by an agent's `type`
  readonly dt: number; // fixed timestep (s)
  time: number; // elapsed sim time (s)
  tickCount: number; // number of ticks executed
}

export function createWorld(
  graph: LaneGraph,
  capacity: number,
  vparams: readonly VParams[] = DEFAULT_VPARAMS,
): World {
  return {
    graph,
    agents: createAgentStore(capacity),
    occ: createLaneOccupancy(graph.laneCount),
    vparams,
    dt: DT,
    time: 0,
    tickCount: 0,
  };
}
