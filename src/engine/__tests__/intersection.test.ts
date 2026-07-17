import { describe, it, expect } from 'vitest';
import {
  buildLaneGraph,
  createWorld,
  tick,
  allocAgent,
  pushBack,
  nextConnection,
  mustYield,
  NONE,
  EPS,
  type World,
} from '../index';

function crossing() {
  return buildLaneGraph(
    [
      { length: 100, speedLimit: 16, fromNode: 0, toNode: 1 },
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 2 },
      { length: 100, speedLimit: 16, fromNode: 3, toNode: 1 },
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 4 },
    ],
    [
      { fromLane: 0, toLane: 1, rank: 2, conflicts: [1] },
      { fromLane: 2, toLane: 3, rank: 1, conflicts: [0] },
    ],
  );
}

function put(world: World, lane: number, s: number, v: number): number {
  const id = allocAgent(world.agents);
  world.agents.s[id] = s;
  world.agents.v[id] = v;
  world.agents.type[id] = 0;
  world.agents.enterTime[id] = world.time;
  pushBack(world.agents, world.occ, lane, id);
  return id;
}

function noOverlap(world: World, lane: number): boolean {
  const { agents, occ, vparams } = world;
  let prev = NONE;
  for (let id = occ.head[lane]; id !== NONE; id = agents.behind[id]) {
    if (prev !== NONE) {
      const gap = agents.s[prev] - agents.s[id] - vparams[agents.type[prev]].length;
      if (gap < -EPS) return false;
    }
    prev = id;
  }
  return true;
}

describe('intersection: nextConnection', () => {
  it('returns the single outgoing connection, or NONE for a sink lane', () => {
    const w = createWorld(crossing(), 32);
    const onA = put(w, 0, 50, 0);
    const onC = put(w, 1, 50, 0);
    const onB = put(w, 2, 50, 0);
    const onD = put(w, 3, 50, 0);
    expect(nextConnection(w, onA)).not.toBe(NONE);
    expect(nextConnection(w, onC)).toBe(NONE);
    expect(nextConnection(w, onB)).not.toBe(NONE);
    expect(nextConnection(w, onD)).toBe(NONE);
  });
});

describe('intersection: strict-priority gap acceptance', () => {
  it('the minor road yields only when a major car is approaching', () => {
    const w = createWorld(crossing(), 32);
    const b = put(w, 2, 99, 2);
    const bConn = nextConnection(w, b);
    expect(mustYield(w, bConn)).toBe(false);

    put(w, 0, 90, 14);
    expect(mustYield(w, bConn)).toBe(true);
  });

  it('the major road never yields to the minor road', () => {
    const w = createWorld(crossing(), 32);
    const a = put(w, 0, 99, 5);
    put(w, 2, 99, 14);
    expect(mustYield(w, nextConnection(w, a))).toBe(false);
  });
});

describe('intersection: lane transition (moveToLane)', () => {
  it('a car with no conflict crosses A->C and completes its trip', () => {
    const w = createWorld(crossing(), 32);
    put(w, 0, 0, 0);

    let sawOnC = false;
    for (let n = 0; n < 200; n++) {
      tick(w);
      if (w.occ.head[1] !== NONE) sawOnC = true;
    }
    expect(sawOnC).toBe(true);
    expect(w.metrics.completedTrips).toBe(1);
  });
});

describe('intersection: whole junction under demand', () => {
  const build = (seed: number) => {
    const w = createWorld(crossing(), 64, undefined, seed);
    w.demand.push({ lane: 0, rate: 0.35 });
    w.demand.push({ lane: 2, rate: 0.45 });
    return w;
  };

  it('both movements flow with no overlap on any lane', () => {
    const w = build(42);
    let sawC = false;
    let sawD = false;
    for (let n = 0; n < 900; n++) {
      tick(w);
      if (w.occ.head[1] !== NONE) sawC = true;
      if (w.occ.head[3] !== NONE) sawD = true;
      for (let lane = 0; lane < 4; lane++) expect(noOverlap(w, lane)).toBe(true);
    }
    expect(sawC).toBe(true);
    expect(sawD).toBe(true);
    expect(w.metrics.completedTrips).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = build(7);
    const b = build(7);
    for (let n = 0; n < 300; n++) {
      tick(a);
      tick(b);
    }
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.lane[i]).toBe(b.agents.lane[i]);
    }
  });
});
