import type { World } from './world';
import { NONE } from './types';
import { STOP_OFFSET, SIGNAL_RED, SIGNAL_NONE } from './constants';
import { nextConnection, mustYield } from './intersection';

export interface Leader {
  readonly gap: number;
  readonly leadV: number;
}

const OPEN_ROAD: Leader = { gap: Infinity, leadV: 0 };

export function findLeader(world: World, i: number): Leader {
  const { agents, occ, graph, vparams, control } = world;
  const lane = agents.lane[i];
  const si = agents.s[i];

  let gap = Infinity;
  let leadV = 0;
  const j = agents.ahead[i];
  if (j !== NONE) {
    gap = agents.s[j] - si - vparams[agents.type[j]].length;
    leadV = agents.v[j];
  }
  const block = control.incidentAt[lane];
  if (block < Infinity && block > si && block - si < gap) {
    gap = block - si;
    leadV = 0;
  }
  if (gap < Infinity) return { gap: Math.max(gap, 0), leadV };

  const c = nextConnection(world, i);
  if (c === NONE) return OPEN_ROAD;

  const conn = graph.connections[c];
  const sig = control.signal[c];
  const held =
    sig === SIGNAL_RED ||
    control.laneClosed[conn.toLane] === 1 ||
    (sig === SIGNAL_NONE && mustYield(world, c));
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
