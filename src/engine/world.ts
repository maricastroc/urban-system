import { createAgentStore, type AgentStore } from './agents';
import { createLaneOccupancy, type LaneOccupancy } from './laneList';
import { createControl, type ScenarioControl } from './control';
import { DT, DEFAULT_VPARAMS } from './constants';
import type { LaneGraph } from './laneGraph';
import type { LaneId, VParams } from './types';

export interface RouteRef {
  readonly start: number;
  readonly end: number;
}

export interface SpawnSource {
  readonly lane: LaneId;
  rate: number;
  readonly speed?: number;
  routes?: readonly RouteRef[];
}

export interface SimMetrics {
  completedTrips: number;
  totalTravelTime: number;
}

export interface World {
  readonly graph: LaneGraph;
  readonly agents: AgentStore;
  readonly occ: LaneOccupancy;
  readonly control: ScenarioControl;
  readonly vparams: readonly VParams[];
  readonly dt: number;
  demand: SpawnSource[];
  routeBuffer: number[];
  metrics: SimMetrics;
  rngState: number;
  time: number;
  tickCount: number;
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
