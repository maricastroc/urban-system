import type { World } from './world';
import { NONE } from './types';
import { popFront } from './laneList';
import { freeAgent } from './agents';

/**
 * FASE 3 — advance vehicles across the network and remove finished trips (design doc §G).
 *
 * Single lane for now: a car that reaches the end of a sink lane has completed its trip, so it
 * is despawned and its travel time recorded. Lane transitions across a road network need
 * routing (choosing which outgoing connection to take), which arrives with the intersection
 * Etapa. Until then, reaching the end of a lane that *has* outgoing connections is treated as a
 * hard error rather than a silent wrong turn.
 */
export function advance(world: World): void {
  const { agents, occ, graph, metrics } = world;

  for (let lane = 0; lane < graph.laneCount; lane++) {
    let head = occ.head[lane];
    while (head !== NONE && agents.s[head] >= graph.length[lane]) {
      if (graph.connEnd[lane] > graph.connStart[lane]) {
        throw new Error('lane transitions not implemented yet (routing/intersection Etapa)');
      }
      const id = popFront(agents, occ, lane);
      metrics.completedTrips += 1;
      metrics.totalTravelTime += world.time - agents.enterTime[id];
      freeAgent(agents, id);
      head = occ.head[lane];
    }
  }
}
