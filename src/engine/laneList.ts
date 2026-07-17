import type { AgentStore } from './agents';
import type { LaneId } from './types';
import { NONE } from './types';

export interface LaneOccupancy {
  readonly head: Int32Array;
  readonly tail: Int32Array;
}

export function createLaneOccupancy(laneCount: number): LaneOccupancy {
  return {
    head: new Int32Array(laneCount).fill(NONE),
    tail: new Int32Array(laneCount).fill(NONE),
  };
}

export function pushBack(
  agents: AgentStore,
  occ: LaneOccupancy,
  lane: LaneId,
  id: number,
): void {
  const oldTail = occ.tail[lane];
  agents.lane[id] = lane;
  agents.ahead[id] = oldTail;
  agents.behind[id] = NONE;
  if (oldTail === NONE) {
    occ.head[lane] = id;
    agents.behind[oldTail] = id;
  }
  occ.tail[lane] = id;
}

export function popFront(agents: AgentStore, occ: LaneOccupancy, lane: LaneId): number {
  const id = occ.head[lane];
  if (id === NONE) return NONE;

  const next = agents.behind[id];
  if (next === NONE) {
    occ.tail[lane] = NONE;
  } else {
    agents.ahead[next] = NONE;
  }
  occ.head[lane] = next;

  agents.ahead[id] = NONE;
  agents.behind[id] = NONE;
  return id;
}
