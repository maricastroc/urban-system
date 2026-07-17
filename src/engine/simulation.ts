import type { World } from './world';
import { NONE } from './types';
import { findLeader } from './neighbors';
import { idmAcceleration, integrate } from './idm';
import { spawn } from './spawn';
import { advance } from './movement';
import { updateSignals } from './control';

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

function integrateAgents(world: World): void {
  const { agents, occ, graph } = world;
  for (let lane = 0; lane < graph.laneCount; lane++) {
    for (let i = occ.head[lane]; i !== NONE; i = agents.behind[i]) {
      integrate(world, i);
    }
  }
}

export function tick(world: World): void {
  updateSignals(world);
  spawn(world);
  computeAccelerations(world);
  integrateAgents(world);
  advance(world);

  world.time += world.dt;
  world.tickCount += 1;
}

export function run(world: World, ticks: number): void {
  for (let n = 0; n < ticks; n++) tick(world);
}
