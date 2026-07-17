import type { World } from './world';
import type { LaneGraph } from './laneGraph';
import { NONE } from './types';
import { T_SAFE, V_EPS } from './constants';

export function nextConnection(world: World, i: number): number {
  const { agents, graph, routeBuffer } = world;
  const lane = agents.lane[i];

  if (agents.routeEnd[i] > agents.routeStart[i]) {
    const idx = agents.routeIdx[i];
    if (idx + 1 < agents.routeEnd[i]) {
      return connectionFromTo(graph, lane, routeBuffer[idx + 1]);
    }
    return NONE;
  }

  const start = graph.connStart[lane];
  const end = graph.connEnd[lane];
  if (end <= start) return NONE;
  if (end - start > 1) {
    throw new Error(`lane ${lane} has multiple exits; a route is required`);
  }
  return start;
}

export function connectionFromTo(graph: LaneGraph, from: number, to: number): number {
  for (let c = graph.connStart[from]; c < graph.connEnd[from]; c++) {
    if (graph.connections[c].toLane === to) return c;
  }
  throw new Error(`no connection ${from} -> ${to} (inconsistent route)`);
}

export function mustYield(world: World, c: number): boolean {
  const { graph, agents, occ, control } = world;
  const conn = graph.connections[c];
  const myRank = control.rank[c];

  for (const c2 of conn.conflicts) {
    const other = graph.connections[c2];
    if (control.rank[c2] <= myRank) continue;

    const k = occ.head[other.fromLane];
    if (k === NONE) continue;

    const dist = graph.length[other.fromLane] - agents.s[k];
    const tta = dist / Math.max(agents.v[k], V_EPS);
    if (tta < T_SAFE) return true;
  }
  return false;
}
