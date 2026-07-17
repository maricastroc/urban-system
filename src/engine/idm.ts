import type { World } from './world';
import type { VParams } from './types';
import { NONE } from './types';
import { B_MAX, EPS } from './constants';

export function idmAcceleration(
  v: number,
  v0: number,
  gap: number,
  leadV: number,
  p: VParams,
): number {
  const dv = v - leadV;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const g = Math.max(gap, 0.01);
  const free = 1 - Math.pow(v / v0, p.delta);
  const interaction = (sStar / g) ** 2;
  return p.aMax * (free - interaction);
}

export function integrate(world: World, i: number): void {
  const { agents, vparams, dt } = world;
  const p = vparams[agents.type[i]];

  const acc = clamp(agents.a[i], -B_MAX, p.aMax);
  const v = agents.v[i];
  const vNew = v + acc * dt;

  if (vNew < 0) {
    agents.s[i] += (-0.5 * v * v) / acc;
    agents.v[i] = 0;
  } else {
    agents.s[i] += v * dt + 0.5 * acc * dt * dt;
    agents.v[i] = vNew;
  }
  agents.a[i] = acc;

  const j = agents.ahead[i];
  if (j !== NONE) {
    const maxS = agents.s[j] - vparams[agents.type[j]].length - EPS;
    if (agents.s[i] > maxS) agents.s[i] = maxS;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
