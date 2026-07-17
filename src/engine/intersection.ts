import type { World } from './world';
import type { LaneGraph } from './laneGraph';
import { NONE } from './types';
import { T_SAFE, V_EPS } from './constants';

/**
 * The outgoing connection index the car `i` will take at the end of its current lane, or NONE if
 * it has arrived (route exhausted, or a sink lane).
 *
 * A routed car reads the next lane from its route and picks the connection leading there. A car
 * with no route (manually placed, or a scene without routing) falls back to the single outgoing
 * connection — and a lane with several exits then requires a route (a loud, deferred error).
 */
export function nextConnection(world: World, i: number): number {
  const { agents, graph, routeBuffer } = world;
  const lane = agents.lane[i];

  if (agents.routeEnd[i] > agents.routeStart[i]) {
    // Routed car.
    const idx = agents.routeIdx[i];
    if (idx + 1 < agents.routeEnd[i]) {
      return connectionFromTo(graph, lane, routeBuffer[idx + 1]);
    }
    return NONE; // reached its destination
  }

  // Fallback: single outgoing connection.
  const start = graph.connStart[lane];
  const end = graph.connEnd[lane];
  if (end <= start) return NONE;
  if (end - start > 1) {
    throw new Error(`lane ${lane} has multiple exits; a route is required`);
  }
  return start;
}

/** Index of the connection from `from` to `to`, or throw if the route is inconsistent. */
export function connectionFromTo(graph: LaneGraph, from: number, to: number): number {
  for (let c = graph.connStart[from]; c < graph.connEnd[from]; c++) {
    if (graph.connections[c].toLane === to) return c;
  }
  throw new Error(`no connection ${from} -> ${to} (inconsistent route)`);
}

/**
 * Strict-priority gap acceptance (design doc §J): must a car taking connection `c` yield?
 *
 * It yields iff some strictly-higher-rank conflicting movement has an approaching car that will
 * reach the junction within T_SAFE seconds. Ranks are unique per node, so the top-priority
 * movement never yields — there is always someone who may go, hence no deadlock.
 */
export function mustYield(world: World, c: number): boolean {
  const { graph, agents, occ, control } = world;
  const conn = graph.connections[c];
  const myRank = control.rank[c]; // effective rank (a priority flip may have swapped it)

  for (const c2 of conn.conflicts) {
    const other = graph.connections[c2];
    if (control.rank[c2] <= myRank) continue; // only yield to strictly higher priority

    const k = occ.head[other.fromLane]; // nearest car to the junction on the conflicting approach
    if (k === NONE) continue;

    const dist = graph.length[other.fromLane] - agents.s[k];
    const tta = dist / Math.max(agents.v[k], V_EPS);
    if (tta < T_SAFE) return true;
  }
  return false;
}
