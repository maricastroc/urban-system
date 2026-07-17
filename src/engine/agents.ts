import { NONE } from './types';

export interface AgentStore {
  readonly capacity: number;

  readonly active: Uint8Array;
  readonly lane: Int32Array;
  readonly s: Float32Array;
  readonly v: Float32Array;
  readonly a: Float32Array;
  readonly type: Uint8Array;

  readonly ahead: Int32Array;
  readonly behind: Int32Array;

  readonly routeStart: Int32Array;
  readonly routeEnd: Int32Array;
  readonly routeIdx: Int32Array;

  readonly enterTime: Float32Array;

  readonly nextFree: Int32Array;
  freeHead: number;
  activeCount: number;
}

export function createAgentStore(capacity: number): AgentStore {
  const nextFree = new Int32Array(capacity);
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
export function allocAgent(store: AgentStore): number {
  const id = store.freeHead;
  if (id === NONE) return NONE;
  store.freeHead = store.nextFree[id];
  store.active[id] = 1;
  store.ahead[id] = NONE;
  store.behind[id] = NONE;
  store.a[id] = 0;
  store.routeStart[id] = 0;
  store.routeEnd[id] = 0;
  store.routeIdx[id] = 0;
  store.activeCount += 1;
  return id;
}

export function freeAgent(store: AgentStore, id: number): void {
  store.active[id] = 0;
  store.nextFree[id] = store.freeHead;
  store.freeHead = id;
  store.activeCount -= 1;
}
