import { NONE } from './types';

/**
 * Agents stored as a Structure-of-Arrays (design doc §D).
 *
 * The store is plain data (typed arrays + two scalars) and every operation is a free
 * function that mutates the store passed in. That keeps the whole thing transferable
 * across a Web Worker / SharedArrayBuffer boundary in a later Etapa, with no reshaping.
 */
export interface AgentStore {
  readonly capacity: number;

  readonly active: Uint8Array; // 1 = in simulation
  readonly lane: Int32Array; // current lane id
  readonly s: Float32Array; // longitudinal position within the lane (m)
  readonly v: Float32Array; // speed (m/s)
  readonly a: Float32Array; // acceleration produced this tick (output)
  readonly type: Uint8Array; // VehicleType (index into a VParams catalog)

  // O(1) neighbour access: per-lane doubly-linked list ordered by descending s.
  readonly ahead: Int32Array; // car immediately in front in the same lane (NONE = frontmost)
  readonly behind: Int32Array; // car immediately behind (NONE = last)

  // Route as a slice of a shared lane-id buffer, filled by spawn/A* in a later Etapa.
  readonly routeStart: Int32Array;
  readonly routeEnd: Int32Array;
  readonly routeIdx: Int32Array;

  readonly enterTime: Float32Array; // sim time the agent entered (travel-time metrics)

  // Free-list of reusable slots.
  readonly nextFree: Int32Array;
  freeHead: number; // head of the free-list, or NONE when the store is full
  activeCount: number;
}

export function createAgentStore(capacity: number): AgentStore {
  const nextFree = new Int32Array(capacity);
  // Initialise the free-list chain: 0 -> 1 -> ... -> (capacity - 1) -> NONE.
  for (let i = 0; i < capacity; i++) nextFree[i] = i + 1 < capacity ? i + 1 : NONE;

  return {
    capacity,
    active: new Uint8Array(capacity),
    lane: new Int32Array(capacity),
    s: new Float32Array(capacity),
    v: new Float32Array(capacity),
    a: new Float32Array(capacity),
    type: new Uint8Array(capacity),
    ahead: new Int32Array(capacity),
    behind: new Int32Array(capacity),
    routeStart: new Int32Array(capacity),
    routeEnd: new Int32Array(capacity),
    routeIdx: new Int32Array(capacity),
    enterTime: new Float32Array(capacity),
    nextFree,
    freeHead: capacity > 0 ? 0 : NONE,
    activeCount: 0,
  };
}

/**
 * Reserve a slot. Returns the agent id, or NONE if the store is full.
 * Resets only the structural fields; spawn logic fills lane/s/v/route later.
 */
export function allocAgent(store: AgentStore): number {
  const id = store.freeHead;
  if (id === NONE) return NONE;
  store.freeHead = store.nextFree[id];
  store.active[id] = 1;
  store.ahead[id] = NONE;
  store.behind[id] = NONE;
  store.a[id] = 0;
  store.activeCount += 1;
  return id;
}

/**
 * Return a slot to the free-list. The caller must have already unlinked the agent
 * from its lane (see laneList.popFront) before freeing it.
 */
export function freeAgent(store: AgentStore, id: number): void {
  store.active[id] = 0;
  store.nextFree[id] = store.freeHead;
  store.freeHead = id;
  store.activeCount -= 1;
}
