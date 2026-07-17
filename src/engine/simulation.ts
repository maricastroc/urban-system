import type { World } from './world';
import { NONE } from './types';
import { findLeader } from './neighbors';
import { idmAcceleration, integrate } from './idm';
import { spawn } from './spawn';
import { advance } from './movement';

/**
 * FASE 1 — compute every agent's acceleration from the current state.
 * Read-only on positions/speeds; writes only each agent's a[i]. Because it reads no a[],
 * the per-agent order does not matter — the step stays deterministic and order-independent.
 */
function computeAccelerations(world: World): void {
  const { agents, occ, graph, vparams } = world;
  for (let lane = 0; lane < graph.laneCount; lane++) {
    for (let i = occ.head[lane]; i !== NONE; i = agents.behind[i]) {
      const p = vparams[agents.type[i]];
      const v0 = graph.speedLimit[lane] * p.v0Factor;
      const leader = findLeader(world, i);
      agents.a[i] = idmAcceleration(agents.v[i], v0, leader.gap, leader.leadV, p);
    }
  }
}

/**
 * FASE 2 — integrate every agent using the a[i] computed in FASE 1.
 * Iterates front -> back per lane so the overlap guard inside integrate() sees the leader's
 * already-updated position, which guarantees no end-of-tick overlap.
 */
function integrateAgents(world: World): void {
  const { agents, occ, graph } = world;
  for (let lane = 0; lane < graph.laneCount; lane++) {
    for (let i = occ.head[lane]; i !== NONE; i = agents.behind[i]) {
      integrate(world, i);
    }
  }
}

/** Advance the simulation by one fixed step (design doc §G). */
export function tick(world: World): void {
  spawn(world); // FASE 0 — demand injection
  computeAccelerations(world); // FASE 1 — accelerations, read-only
  integrateAgents(world); // FASE 2 — integration, write
  advance(world); // FASE 3 — lane transitions & despawn (records metrics)

  world.time += world.dt;
  world.tickCount += 1;
}

/** Convenience helper: run `ticks` steps in sequence. */
export function run(world: World, ticks: number): void {
  for (let n = 0; n < ticks; n++) tick(world);
}
