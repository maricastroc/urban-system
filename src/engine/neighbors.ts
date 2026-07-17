import type { World } from './world';
import { NONE } from './types';

/** What an agent is following: net gap to the obstacle (m) and its speed (m/s). */
export interface Leader {
  readonly gap: number; // bumper-to-bumper distance (m); Infinity on open road
  readonly leadV: number; // obstacle speed (m/s); 0 on open road
}

// Shared instance for the common "no obstacle" case, so a lone car allocates nothing.
const OPEN_ROAD: Leader = { gap: Infinity, leadV: 0 };

/**
 * Find the obstacle an agent must react to (design doc §H).
 *
 * Etapa 2 (single lane, no intersection) implements only two of the doc's cases:
 *   (1)  a leader in the same lane, and
 *   (2c) open road when the agent is the frontmost car.
 *
 * The intersection cases — a virtual stopped leader at the stop line (§H 2a) and the last
 * car of the downstream lane (§H 2b) — arrive with the intersection Etapa. This function is
 * the single seam where they will plug in, so the physics never has to change.
 *
 * Returns a small record for the same-lane case; the performance Etapa can switch to
 * out-params to avoid that per-tick allocation.
 */
export function findLeader(world: World, i: number): Leader {
  const { agents, vparams } = world;
  const j = agents.ahead[i];
  if (j === NONE) return OPEN_ROAD; // frontmost car: no intersection handling yet
  const gap = agents.s[j] - agents.s[i] - vparams[agents.type[j]].length;
  return { gap, leadV: agents.v[j] };
}
