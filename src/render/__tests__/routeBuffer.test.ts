import { describe, it, expect } from 'vitest';
import { tick } from '@/engine';
import { createScene, applyRoutes } from '../scene';

describe('applyRoutes: route buffer stays bounded while routing survives interventions', () => {
  it('keeps completing trips and does not grow routeBuffer across repeated re-routes', () => {
    const scene = createScene(2.0);
    const { world } = scene;

    for (let n = 0; n < 200; n++) tick(world);
    expect(world.agents.activeCount).toBeGreaterThan(0);

    const tripsBeforeInterventions = world.metrics.completedTrips;

    const bufSizes: number[] = [];
    for (let round = 0; round < 100; round++) {
      applyRoutes(scene);
      for (let n = 0; n < 20; n++) tick(world);
      bufSizes.push(world.routeBuffer.length);
    }

    expect(world.metrics.completedTrips).toBeGreaterThan(tripsBeforeInterventions);

    const early = Math.max(...bufSizes.slice(0, 10));
    const late = Math.max(...bufSizes.slice(-10));
    expect(late).toBeLessThanOrEqual(early * 2 + 128);
  });
});
