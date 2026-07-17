import type { AgentStore } from './agents';
import type { LaneId } from './types';
import { NONE } from './types';

/**
 * Dynamic per-lane occupancy (design doc §E): `head` = frontmost car (largest s),
 * `tail` = last car (smallest s). Together with agents.ahead/behind this forms a
 * per-lane doubly-linked list ordered by descending s.
 *
 * V1 invariant: with no lane changing, cars never overtake within a lane, so the list
 * is only ever mutated at the back (on entry) and the front (on exit) — it stays
 * ordered without any sorting. That is exactly why all ordering logic is centralised
 * here: it is the subtle correctness core of the whole engine.
 */
export interface LaneOccupancy {
  readonly head: Int32Array; // per lane: frontmost agent id, or NONE
  readonly tail: Int32Array; // per lane: last agent id, or NONE
}

export function createLaneOccupancy(laneCount: number): LaneOccupancy {
  return {
    head: new Int32Array(laneCount).fill(NONE),
    tail: new Int32Array(laneCount).fill(NONE),
  };
}

/**
 * Append an agent to the BACK of a lane (it just entered, so it has the smallest s).
 * Sets the agent's lane so the store stays the single source of truth for membership.
 */
export function pushBack(
  agents: AgentStore,
  occ: LaneOccupancy,
  lane: LaneId,
  id: number,
): void {
  const oldTail = occ.tail[lane];
  agents.lane[id] = lane;
  agents.ahead[id] = oldTail; // the previous last car is now ahead of the newcomer
  agents.behind[id] = NONE;
  if (oldTail === NONE) {
    occ.head[lane] = id; // lane was empty
  } else {
    agents.behind[oldTail] = id;
  }
  occ.tail[lane] = id;
}

/**
 * Remove and return the FRONT agent of a lane (it has crossed the lane's end).
 * Returns NONE if the lane is empty. Leaves the removed agent unlinked (ahead/behind = NONE).
 */
export function popFront(agents: AgentStore, occ: LaneOccupancy, lane: LaneId): number {
  const id = occ.head[lane];
  if (id === NONE) return NONE;

  const next = agents.behind[id]; // the car just behind becomes the new front
  if (next === NONE) {
    occ.tail[lane] = NONE; // lane is now empty
  } else {
    agents.ahead[next] = NONE;
  }
  occ.head[lane] = next;

  agents.ahead[id] = NONE;
  agents.behind[id] = NONE;
  return id;
}
