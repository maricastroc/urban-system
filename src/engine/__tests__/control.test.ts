import { describe, it, expect } from 'vitest';
import {
  buildLaneGraph,
  createWorld,
  tick,
  run,
  allocAgent,
  pushBack,
  mustYield,
  computeRoute,
  closeLane,
  openLane,
  setIncident,
  swapRanks,
  createSignal,
  addSignal,
  disableSignal,
  connectionFromTo,
  NONE,
  type World,
} from '../index';

function put(world: World, lane: number, s: number, v: number): number {
  const id = allocAgent(world.agents);
  world.agents.s[id] = s;
  world.agents.v[id] = v;
  world.agents.type[id] = 0;
  world.agents.enterTime[id] = world.time;
  pushBack(world.agents, world.occ, lane, id);
  return id;
}

// A one-in / one-out chain: lane 0 (length 50) -> lane 1 (sink). Single-exit, so a car needs no
// route — `nextConnection` falls back to the only connection.
function chain() {
  return buildLaneGraph(
    [
      { length: 50, speedLimit: 16, fromNode: 0, toNode: 1 },
      { length: 50, speedLimit: 16, fromNode: 1, toNode: 2 },
    ],
    [{ fromLane: 0, toLane: 1 }],
  );
}

// The priority crossing from intersection.test: A->C (rank 2) conflicts with B->D (rank 1).
function crossing() {
  return buildLaneGraph(
    [
      { length: 100, speedLimit: 16, fromNode: 0, toNode: 1 }, // 0: A (in)
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 2 }, // 1: C (sink)
      { length: 100, speedLimit: 16, fromNode: 3, toNode: 1 }, // 2: B (in)
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 4 }, // 3: D (sink)
    ],
    [
      { fromLane: 0, toLane: 1, rank: 2, conflicts: [1] }, // A->C major (index 0)
      { fromLane: 2, toLane: 3, rank: 1, conflicts: [0] }, // B->D minor (index 1)
    ],
  );
}

describe('control: closing a lane', () => {
  it('holds a car at the entrance of a closed lane and lets it through once reopened', () => {
    const w = createWorld(chain(), 16);
    const car = put(w, 0, 0, 0);
    closeLane(w.control, 1); // shut the road ahead

    run(w, 300);
    expect(w.agents.active[car]).toBe(1); // still in the sim...
    expect(w.agents.lane[car]).toBe(0); // ...held on lane 0, never entered lane 1
    expect(w.agents.s[car]).toBeLessThan(w.graph.length[0]); // stopped short of the stop line
    expect(w.agents.v[car]).toBeLessThan(0.1); // and at rest
    expect(w.occ.head[1]).toBe(NONE); // nothing on the closed lane

    openLane(w.control, 1);
    run(w, 300);
    expect(w.metrics.completedTrips).toBe(1); // the car finally crossed and finished
  });
});

describe('control: an incident', () => {
  it('stops traffic behind a mid-lane obstruction, without overlap', () => {
    const w = createWorld(chain(), 16);
    // Two cars nose-to-tail-ish on lane 0; an incident sits ahead of both. The lane list is ordered
    // by descending s, so the leading car must be pushed first (see laneList invariant).
    const front = put(w, 0, 12, 0);
    const back = put(w, 0, 4, 0);
    setIncident(w.control, 0, 35);

    run(w, 400);
    // Both queue behind the incident (front bumper never passes it) and come to rest.
    expect(w.agents.s[front]).toBeLessThanOrEqual(35);
    expect(w.agents.s[front]).toBeGreaterThan(25); // pulled up close to the obstruction
    expect(w.agents.v[front]).toBeLessThan(0.1);
    expect(w.agents.v[back]).toBeLessThan(0.1);
    const gap = w.agents.s[front] - w.agents.s[back] - w.vparams[0].length;
    expect(gap).toBeGreaterThan(-0.05); // no overlap between the two queued cars
    expect(w.metrics.completedTrips).toBe(0); // nobody got past
  });
});

describe('control: routing around a closure', () => {
  // A diamond: 0 -> {1 (short) | 2 (long)} -> 3. Shortest path prefers lane 1.
  function diamond() {
    return buildLaneGraph(
      [
        { length: 10, speedLimit: 16, fromNode: 0, toNode: 1 }, // 0: entry
        { length: 10, speedLimit: 16, fromNode: 1, toNode: 2 }, // 1: short arm
        { length: 40, speedLimit: 16, fromNode: 1, toNode: 2 }, // 2: long arm
        { length: 10, speedLimit: 16, fromNode: 2, toNode: 3 }, // 3: exit (sink)
      ],
      [
        { fromLane: 0, toLane: 1 },
        { fromLane: 0, toLane: 2 },
        { fromLane: 1, toLane: 3 },
        { fromLane: 2, toLane: 3 },
      ],
    );
  }

  it('detours through the long arm when the short one is closed', () => {
    const g = diamond();
    expect(computeRoute(g, 0, 3)).toEqual([0, 1, 3]); // prefers the short arm

    const closed = new Uint8Array(g.laneCount);
    closed[1] = 1;
    expect(computeRoute(g, 0, 3, closed)).toEqual([0, 2, 3]); // routes around it
  });
});

describe('control: priority flip', () => {
  it('swaps which approach must yield', () => {
    const w = createWorld(crossing(), 16);
    const ac = connectionFromTo(w.graph, 0, 1); // A->C (major)
    const bd = connectionFromTo(w.graph, 2, 3); // B->D (minor)

    put(w, 0, 90, 14); // fast A car near the junction
    put(w, 2, 90, 14); // fast B car near the junction

    expect(mustYield(w, bd)).toBe(true); // minor yields to major
    expect(mustYield(w, ac)).toBe(false); // major does not yield

    swapRanks(w.control, [ac], [bd]); // flip the priority

    expect(mustYield(w, ac)).toBe(true); // now A yields
    expect(mustYield(w, bd)).toBe(false); // and B has priority
  });
});

describe('control: traffic signals', () => {
  it('holds the red approach and releases the green one', () => {
    const w = createWorld(crossing(), 16);
    const ac = connectionFromTo(w.graph, 0, 1); // A->C
    const bd = connectionFromTo(w.graph, 2, 3); // B->D

    // A single long phase: A green, B red. Never cycles within the test window.
    addSignal(w.control, createSignal([[ac], [bd]], [1000, 1000]));

    put(w, 0, 0, 0); // an A car
    put(w, 2, 0, 0); // a B car

    run(w, 200);
    expect(w.occ.head[3]).toBe(NONE); // B never crossed onto D (held red)
    // The B car is stopped at its line; the A car has moved on (crossed or finished).
    let bStopped = false;
    for (let id = w.occ.head[2]; id !== NONE; id = w.agents.behind[id]) bStopped = true;
    expect(bStopped).toBe(true);
    expect(w.metrics.completedTrips).toBeGreaterThanOrEqual(1); // A got through
  });

  it('cycles phases and is deterministic', () => {
    const build = () => {
      const w = createWorld(crossing(), 64, undefined, 5);
      const ac = connectionFromTo(w.graph, 0, 1);
      const bd = connectionFromTo(w.graph, 2, 3);
      addSignal(w.control, createSignal([[ac], [bd]], [4, 4])); // 4s each way
      w.demand.push({ lane: 0, rate: 0.4 });
      w.demand.push({ lane: 2, rate: 0.4 });
      return w;
    };
    const a = build();
    const b = build();
    for (let n = 0; n < 400; n++) {
      tick(a);
      tick(b);
    }
    expect(a.metrics.completedTrips).toBeGreaterThan(0);
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.lane[i]).toBe(b.agents.lane[i]);
    }
  });

  it('reverts to priority give-way when disabled', () => {
    const w = createWorld(crossing(), 16);
    const ac = connectionFromTo(w.graph, 0, 1);
    const bd = connectionFromTo(w.graph, 2, 3);
    const sc = createSignal([[ac], [bd]], [1000, 1000]);
    addSignal(w.control, sc); // A green, B red

    disableSignal(w.control, sc);
    // Back to priority: with fast conflicting traffic, minor yields, major does not.
    put(w, 0, 90, 14);
    put(w, 2, 90, 14);
    expect(mustYield(w, bd)).toBe(true);
    expect(mustYield(w, ac)).toBe(false);
  });
});
