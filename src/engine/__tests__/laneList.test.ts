import { describe, it, expect } from 'vitest';
import {
  createAgentStore,
  allocAgent,
  freeAgent,
  createLaneOccupancy,
  pushBack,
  popFront,
  NONE,
} from '../index';

describe('per-lane ordered list (the no-overtaking invariant)', () => {
  it('keeps entry order front -> back and wires ahead/behind consistently', () => {
    const agents = createAgentStore(4);
    const occ = createLaneOccupancy(1);
    const lane = 0;

    // Three cars enter the lane in order a, b, c. Each newcomer joins at the back,
    // so front -> back must be a, b, c.
    const a = allocAgent(agents);
    const b = allocAgent(agents);
    const c = allocAgent(agents);
    pushBack(agents, occ, lane, a);
    pushBack(agents, occ, lane, b);
    pushBack(agents, occ, lane, c);

    expect(occ.head[lane]).toBe(a);
    expect(occ.tail[lane]).toBe(c);

    // ahead chain: a is frontmost; c is behind b is behind a.
    expect(agents.ahead[a]).toBe(NONE);
    expect(agents.ahead[b]).toBe(a);
    expect(agents.ahead[c]).toBe(b);

    // behind chain: mirror of the above.
    expect(agents.behind[a]).toBe(b);
    expect(agents.behind[b]).toBe(c);
    expect(agents.behind[c]).toBe(NONE);

    // Every car knows it is on this lane.
    expect(agents.lane[a]).toBe(lane);
    expect(agents.lane[c]).toBe(lane);
  });

  it('popFront removes the frontmost car and promotes the next', () => {
    const agents = createAgentStore(4);
    const occ = createLaneOccupancy(1);
    const lane = 0;

    const a = allocAgent(agents);
    const b = allocAgent(agents);
    const c = allocAgent(agents);
    pushBack(agents, occ, lane, a);
    pushBack(agents, occ, lane, b);
    pushBack(agents, occ, lane, c);

    expect(popFront(agents, occ, lane)).toBe(a);
    expect(occ.head[lane]).toBe(b);
    expect(agents.ahead[b]).toBe(NONE); // b is now frontmost
    expect(occ.tail[lane]).toBe(c); // tail unchanged

    expect(popFront(agents, occ, lane)).toBe(b);
    expect(popFront(agents, occ, lane)).toBe(c);

    // Lane is empty again.
    expect(occ.head[lane]).toBe(NONE);
    expect(occ.tail[lane]).toBe(NONE);
    expect(popFront(agents, occ, lane)).toBe(NONE);
  });

  it('leaves the removed agent fully unlinked', () => {
    const agents = createAgentStore(2);
    const occ = createLaneOccupancy(1);
    const a = allocAgent(agents);
    const b = allocAgent(agents);
    pushBack(agents, occ, 0, a);
    pushBack(agents, occ, 0, b);

    popFront(agents, occ, 0);
    expect(agents.ahead[a]).toBe(NONE);
    expect(agents.behind[a]).toBe(NONE);
  });
});

describe('agent free-list', () => {
  it('reuses freed slots and reports full capacity', () => {
    const agents = createAgentStore(2);

    const a = allocAgent(agents);
    const b = allocAgent(agents);
    expect(a).not.toBe(NONE);
    expect(b).not.toBe(NONE);
    expect(agents.activeCount).toBe(2);

    // Store is full now.
    expect(allocAgent(agents)).toBe(NONE);

    // Free one, and the next alloc succeeds again.
    freeAgent(agents, a);
    expect(agents.activeCount).toBe(1);
    const reused = allocAgent(agents);
    expect(reused).not.toBe(NONE);
    expect(agents.activeCount).toBe(2);
  });
});
