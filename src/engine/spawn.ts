import type { World } from './world';
import { NONE } from './types';
import { SPAWN_CLEARANCE } from './constants';
import { nextRandom } from './rng';
import { allocAgent } from './agents';
import { pushBack } from './laneList';

/**
 * FASE 0 — admit new vehicles from demand (design doc §G.1).
 *
 * Each source is a Bernoulli arrival per tick with p = rate * dt (a discrete Poisson
 * approximation). An arrival that finds the source occupied is dropped — a simple loss model;
 * a source queue can come later. Deterministic given the World's seed and demand order.
 */
export function spawn(world: World): void {
  const { agents, occ, dt } = world;

  for (const src of world.demand) {
    const r = nextRandom(world.rngState);
    world.rngState = r.state;
    if (r.value >= src.rate * dt) continue; // no arrival this tick

    const tail = occ.tail[src.lane];
    if (tail !== NONE && agents.s[tail] < SPAWN_CLEARANCE) continue; // no room -> arrival dropped

    const id = allocAgent(agents);
    if (id === NONE) continue; // at capacity

    agents.s[id] = 0;
    agents.v[id] = src.speed ?? 0;
    agents.type[id] = 0;
    agents.enterTime[id] = world.time;
    pushBack(agents, occ, src.lane, id);
  }
}
