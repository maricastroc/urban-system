import { describe, it, expect } from 'vitest';
import { buildLaneGraph, createWorld, tick, run, DT } from '../index';

function tinyGraph() {
  return buildLaneGraph(
    [
      { length: 100, speedLimit: 13.9, fromNode: 0, toNode: 1 },
      { length: 100, speedLimit: 13.9, fromNode: 1, toNode: 2 },
    ],
    [{ fromLane: 0, toLane: 1 }],
  );
}

describe('LaneGraph builder', () => {
  it('lays out lanes and CSR connections', () => {
    const g = tinyGraph();
    expect(g.laneCount).toBe(2);
    expect(g.length[0]).toBe(100);
    expect(g.speedLimit[1]).toBeCloseTo(13.9);

    // Lane 0 has exactly one outgoing connection; lane 1 has none.
    expect(g.connEnd[0] - g.connStart[0]).toBe(1);
    expect(g.connEnd[1] - g.connStart[1]).toBe(0);

    const c = g.connections[g.connStart[0]];
    expect(c.fromLane).toBe(0);
    expect(c.toLane).toBe(1);
    expect(c.length).toBe(0);
    expect(c.rank).toBe(0);
    expect(c.conflicts).toEqual([]);
  });

  it('rejects connections that reference out-of-range lanes', () => {
    expect(() => buildLaneGraph([{ length: 10, speedLimit: 10, fromNode: 0, toNode: 1 }], [
      { fromLane: 0, toLane: 5 },
    ])).toThrow();
  });
});

describe('empty tick loop', () => {
  it('advances the clock by dt and counts ticks', () => {
    const world = createWorld(tinyGraph(), 16);
    expect(world.time).toBe(0);
    expect(world.tickCount).toBe(0);
    expect(world.dt).toBe(DT);

    tick(world);
    expect(world.tickCount).toBe(1);
    expect(world.time).toBeCloseTo(DT);

    run(world, 9);
    expect(world.tickCount).toBe(10);
    expect(world.time).toBeCloseTo(10 * DT);
  });

  it('wires the world with an empty agent store and empty lanes', () => {
    const world = createWorld(tinyGraph(), 16);
    expect(world.agents.capacity).toBe(16);
    expect(world.agents.activeCount).toBe(0);
    expect(world.occ.head).toHaveLength(2);
  });

  it('is deterministic: same start + same ticks -> same clock', () => {
    const a = createWorld(tinyGraph(), 16);
    const b = createWorld(tinyGraph(), 16);
    run(a, 25);
    run(b, 25);
    expect(a.time).toBe(b.time);
    expect(a.tickCount).toBe(b.tickCount);
  });
});
