import type { World } from './world';
import { NONE } from './types';
import { STOP_OFFSET, SIGNAL_RED, SIGNAL_NONE } from './constants';
import { nextConnection, mustYield } from './intersection';

/** What an agent is following: net gap to the obstacle (m) and its speed (m/s). */
export interface Leader {
  readonly gap: number; // bumper-to-bumper distance (m); Infinity on open road
  readonly leadV: number; // obstacle speed (m/s); 0 on open road / at a stop line
}

// Shared instance for the common "no obstacle" case, so a lone car allocates nothing.
const OPEN_ROAD: Leader = { gap: Infinity, leadV: 0 };

/**
 * Find the obstacle an agent must react to (design doc §H, extended by §8 Scenario Control).
 *
 *   (1)  the nearest in-lane obstacle: the car ahead and/or a stopped incident, whichever is closer;
 *        else the agent is the front car on a clear lane and we look beyond the junction:
 *   (2a) a virtual stopped leader at the stop line, if a red signal, a closed downstream lane, or a
 *        priority give-way holds it back;
 *   (2b) the last car of the downstream lane it is about to enter; else
 *   (2c) open road (including a sink lane, whose end is handled by despawn).
 */
export function findLeader(world: World, i: number): Leader {
  const { agents, occ, graph, vparams, control } = world;
  const lane = agents.lane[i];
  const si = agents.s[i];

  // (1) Nearest obstacle within the current lane — the car ahead and/or a stopped incident.
  let gap = Infinity;
  let leadV = 0;
  const j = agents.ahead[i];
  if (j !== NONE) {
    gap = agents.s[j] - si - vparams[agents.type[j]].length;
    leadV = agents.v[j];
  }
  const block = control.incidentAt[lane];
  if (block < Infinity && block > si && block - si < gap) {
    gap = block - si; // a stopped point obstruction: the car queues s0 behind it
    leadV = 0;
  }
  if (gap < Infinity) return { gap: Math.max(gap, 0), leadV };

  // (2) Front car on a clear lane: react to what lies past the junction.
  const c = nextConnection(world, i);
  if (c === NONE) return OPEN_ROAD; // sink lane / route end

  const conn = graph.connections[c];
  const sig = control.signal[c];
  const held =
    sig === SIGNAL_RED || // red light
    control.laneClosed[conn.toLane] === 1 || // the road ahead is closed
    (sig === SIGNAL_NONE && mustYield(world, c)); // priority give-way (only when unsignalized)
  if (held) {
    const stopGap = Math.max(graph.length[lane] - si - STOP_OFFSET, 0);
    return { gap: stopGap, leadV: 0 };
  }

  const tail = occ.tail[conn.toLane];
  if (tail !== NONE) {
    const downstreamGap =
      graph.length[lane] - si + conn.length + agents.s[tail] - vparams[agents.type[tail]].length;
    return { gap: downstreamGap, leadV: agents.v[tail] };
  }
  return OPEN_ROAD;
}
