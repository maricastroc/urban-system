import { describe, it, expect } from 'vitest';
import { buildLaneGraph, createWorld, tick, EPS, type World } from '../index';

function lane(length = 220, speedLimit = 16) {
  return buildLaneGraph([{ length, speedLimit, fromNode: 0, toNode: 1 }]);
}

function withDemand(rate: number, seed = 1): World {
  const world = createWorld(lane(), 64, undefined, seed);
  world.demand.push({ lane: 0, rate });
  return world;
}

// Walk the single lane front -> back and check strict descending s with non-negative gaps.
function noOverlap(world: World): boolean {
  const { agents, occ, vparams } = world;
  let prev = -1;
  for (let id = occ.head[0]; id !== -1; id = agents.behind[id]) {
    if (prev !== -1) {
      const gap = agents.s[prev] - agents.s[id] - vparams[agents.type[prev]].length;
      if (gap < -EPS) return false;
    }
    prev = id;
  }
  return true;
}

describe('FASE 0 — demand-driven spawn', () => {
  it('admits no cars with empty demand', () => {
    const world = createWorld(lane(), 16);
    for (let n = 0; n < 100; n++) tick(world);
    expect(world.agents.activeCount).toBe(0);
  });

  it('admits cars over time from a demand source', () => {
    const world = withDemand(1.5);
    for (let n = 0; n < 100; n++) tick(world);
    expect(world.agents.activeCount).toBeGreaterThan(0);
  });

  it('never overlaps cars at the source, even under very high demand (room-gated)', () => {
    const world = withDemand(5); // p >= 1 -> tries to admit every tick; only room gates it
    for (let n = 0; n < 300; n++) {
      tick(world);
      expect(noOverlap(world)).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = withDemand(2, 12345);
    const b = withDemand(2, 12345);
    for (let n = 0; n < 200; n++) {
      tick(a);
      tick(b);
    }
    expect(a.agents.activeCount).toBe(b.agents.activeCount);
    expect(a.metrics.completedTrips).toBe(b.metrics.completedTrips);
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.v[i]).toBe(b.agents.v[i]);
    }
  });

  it('diverges for different seeds', () => {
    const a = withDemand(1, 1);
    const b = withDemand(1, 999);
    for (let n = 0; n < 200; n++) {
      tick(a);
      tick(b);
    }
    let identical = true;
    for (let i = 0; i < a.agents.capacity; i++) {
      if (a.agents.s[i] !== b.agents.s[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });
});

describe('FASE 3 — despawn at trip end', () => {
  it('despawns cars at the lane end and records their travel time', () => {
    const world = withDemand(2, 7);
    for (let n = 0; n < 600; n++) tick(world);
    expect(world.metrics.completedTrips).toBeGreaterThan(0);
    expect(world.metrics.totalTravelTime).toBeGreaterThan(0);
    // Cars start from rest, so average travel time exceeds the free-flow-at-limit lower bound.
    const avg = world.metrics.totalTravelTime / world.metrics.completedTrips;
    expect(avg).toBeGreaterThan(220 / 16);
  });

  it('keeps the population bounded and never negative', () => {
    const world = withDemand(3, 3);
    for (let n = 0; n < 800; n++) {
      tick(world);
      expect(world.agents.activeCount).toBeGreaterThanOrEqual(0);
      expect(world.agents.activeCount).toBeLessThanOrEqual(world.agents.capacity);
    }
  });
});
