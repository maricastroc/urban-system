import type { World } from './world';
import type { VParams } from './types';
import { NONE } from './types';
import { B_MAX, EPS } from './constants';

/**
 * IDM acceleration (design doc §I). A pure function of the kinematic state, so it can be
 * unit-tested against hand-computed values.
 *
 * @param v     current speed (m/s)
 * @param v0    desired speed (m/s)
 * @param gap   net distance to the leader (m); Infinity for open road
 * @param leadV leader speed (m/s)
 * @param p     the agent's vehicle parameters
 */
export function idmAcceleration(
  v: number,
  v0: number,
  gap: number,
  leadV: number,
  p: VParams,
): number {
  const dv = v - leadV; // approach rate
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const g = Math.max(gap, 0.01); // guard against division by zero
  const free = 1 - Math.pow(v / v0, p.delta);
  const interaction = (sStar / g) ** 2; // -> 0 as gap -> Infinity (open road)
  return p.aMax * (free - interaction);
}

/**
 * Advance one agent by dt using its already-computed acceleration a[i] (design doc §I).
 *
 * The two lines that keep the simulation stable: the `vNew < 0` branch brings a car to rest
 * within the step instead of letting it reverse, and the ballistic position update is far
 * steadier than plain Euler. A final guard clamps the car so it can never overlap the
 * (already-updated) car ahead — a numerical safety net that should not trigger under a
 * well-behaved IDM.
 */
export function integrate(world: World, i: number): void {
  const { agents, vparams, dt } = world;
  const p = vparams[agents.type[i]];

  const acc = clamp(agents.a[i], -B_MAX, p.aMax);
  const v = agents.v[i];
  const vNew = v + acc * dt;

  if (vNew < 0) {
    // Would reverse -> the car comes to rest within this step. acc < 0 here, so the
    // stopping distance -v^2 / (2*acc) is positive.
    agents.s[i] += (-0.5 * v * v) / acc;
    agents.v[i] = 0;
  } else {
    agents.s[i] += v * dt + 0.5 * acc * dt * dt; // ballistic update
    agents.v[i] = vNew;
  }
  agents.a[i] = acc; // record the actually-applied (clamped) acceleration

  const j = agents.ahead[i];
  if (j !== NONE) {
    const maxS = agents.s[j] - vparams[agents.type[j]].length - EPS;
    if (agents.s[i] > maxS) agents.s[i] = maxS;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
