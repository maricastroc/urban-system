import { describe, it, expect } from 'vitest';
import {
  buildLaneGraph,
  createWorld,
  tick,
  run,
  allocAgent,
  pushBack,
  idmAcceleration,
  DEFAULT_VPARAMS,
  EPS,
  type World,
} from '../index';

const P = DEFAULT_VPARAMS[0];

function laneGraph(length = 200, speedLimit = 13.9) {
  return buildLaneGraph([{ length, speedLimit, fromNode: 0, toNode: 1 }]);
}

function place(world: World, lane: number, s: number, v: number, type = 0): number {
  const id = allocAgent(world.agents);
  world.agents.s[id] = s;
  world.agents.v[id] = v;
  world.agents.type[id] = type;
  pushBack(world.agents, world.occ, lane, id);
  return id;
}

describe('IDM acceleration (pure)', () => {
  it('accelerates at ~aMax from rest on open road', () => {
    expect(idmAcceleration(0, 13.9, Infinity, 0, P)).toBeCloseTo(P.aMax, 5);
  });

  it('is ~0 at the desired speed on open road', () => {
    expect(idmAcceleration(13.9, 13.9, Infinity, 0, P)).toBeCloseTo(0, 5);
  });

  it('brakes when the gap to a stopped leader collapses', () => {
    expect(idmAcceleration(13.9, 13.9, 2, 0, P)).toBeLessThan(0);
  });
});

describe('integration on a single lane', () => {
  it('a lone car accelerates toward its desired speed, monotonically, without exceeding it', () => {
    const world = createWorld(laneGraph(100_000), 4);
    const v0 = world.graph.speedLimit[0] * P.v0Factor;
    const car = place(world, 0, 0, 0);

    let prevV = -1;
    let maxV = 0;
    for (let n = 0; n < 400; n++) {
      tick(world);
      const v = world.agents.v[car];
      expect(v).toBeGreaterThanOrEqual(prevV - 1e-6);
      prevV = v;
      maxV = Math.max(maxV, v);
    }
    expect(maxV).toBeLessThanOrEqual(v0 + 1e-3);
    expect(world.agents.v[car]).toBeGreaterThan(v0 * 0.98);
  });

  it('a follower stops smoothly behind a stopped car: never reversing, never overlapping', () => {
    const world = createWorld(laneGraph(), 8);
    const leaderPos = 60;
    const leader = place(world, 0, leaderPos, 0);
    const follower = place(world, 0, 20, 8);

    let minV = Infinity;
    let minGap = Infinity;
    for (let n = 0; n < 800; n++) {
      tick(world);
      // Pin the leader so it stays a stopped obstacle at leaderPos.
      world.agents.s[leader] = leaderPos;
      world.agents.v[leader] = 0;
      const gap = leaderPos - world.agents.s[follower] - P.length;
      minGap = Math.min(minGap, gap);
      minV = Math.min(minV, world.agents.v[follower]);
    }

    expect(minV).toBeGreaterThanOrEqual(0);
    expect(minGap).toBeGreaterThan(-EPS);
    expect(world.agents.v[follower]).toBeCloseTo(0, 2); 
    const finalGap = leaderPos - world.agents.s[follower] - P.length;
    expect(Math.abs(finalGap - P.s0)).toBeLessThan(0.2);
  });

  it('a follower never overlaps the leader while both accelerate from rest', () => {
    const world = createWorld(laneGraph(100_000), 8);
    const leader = place(world, 0, 30, 0);
    const follower = place(world, 0, 0, 0);

    for (let n = 0; n < 400; n++) {
      tick(world);
      const gap = world.agents.s[leader] - world.agents.s[follower] - P.length;
      expect(gap).toBeGreaterThan(-EPS);
      expect(world.agents.v[follower]).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic: identical setups match bit-for-bit after many ticks', () => {
    const build = () => {
      const w = createWorld(laneGraph(100_000), 8);
      place(w, 0, 40, 0);
      place(w, 0, 10, 6);
      return w;
    };
    const a = build();
    const b = build();
    run(a, 300);
    run(b, 300);
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.v[i]).toBe(b.agents.v[i]);
    }
  });
});
