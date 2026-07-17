import { describe, it, expect } from 'vitest';
import { tick, type World } from '@/engine';
import { createScene, setDemandRate } from '../scene';
import { placementAt } from '../geometry';

function avgSpeed(world: World): number {
  const { agents } = world;
  let sum = 0;
  let n = 0;
  for (let id = 0; id < agents.capacity; id++) {
    if (!agents.active[id]) continue;
    sum += agents.v[id];
    n += 1;
  }
  return n ? sum / n : 0;
}

describe('scene + render data path', () => {
  it('starts empty and fills from demand', () => {
    const scene = createScene(2);
    expect(scene.world.agents.activeCount).toBe(0);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });

  it('admitted cars accelerate: average speed rises above zero', () => {
    const scene = createScene(2);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(avgSpeed(scene.world)).toBeGreaterThan(0);
  });

  it('maps s linearly to world x along the straight lane', () => {
    const scene = createScene(1);
    const g = scene.geometry;
    expect(placementAt(g, 0, 0).x).toBeCloseTo(0);
    expect(placementAt(g, 0, 110).x).toBeCloseTo(110);
    expect(placementAt(g, 0, scene.laneLength).x).toBeCloseTo(scene.laneLength);
  });

  it('conserves flow: trips complete and population stays bounded', () => {
    const scene = createScene(2);
    for (let n = 0; n < 600; n++) tick(scene.world);
    expect(scene.world.metrics.completedTrips).toBeGreaterThan(0);
    expect(scene.world.agents.activeCount).toBeLessThanOrEqual(scene.world.agents.capacity);
  });

  it('setDemandRate turns inflow on and off', () => {
    const scene = createScene(0); // no demand
    for (let n = 0; n < 50; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBe(0);

    setDemandRate(scene, 2);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });
});
