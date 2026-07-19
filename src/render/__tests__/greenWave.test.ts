import { describe, it, expect } from 'vitest';
import { tick, type World } from '@/engine';
import { buildGrid } from '../grid';
import {
  createScene,
  greenWave,
  captureConfig,
  applyConfig,
  clearInterventions,
  scenarioSignature,
} from '../scene';

const step = (w: World, n: number) => {
  for (let i = 0; i < n; i++) tick(w);
};

describe('grid corridors', () => {
  it('emits one corridor per row and per column, ordered in travel direction', () => {
    const { corridors } = buildGrid(3, 3);
    expect(corridors.filter((c) => c.axis === 'H').length).toBe(3);
    expect(corridors.filter((c) => c.axis === 'V').length).toBe(3);
    const rows = corridors.filter((c) => c.axis === 'H');
    expect(rows[0].junctions).toEqual([0, 1, 2]);
    expect(rows[1].junctions).toEqual([5, 4, 3]);
  });
});

describe('green wave', () => {
  it('signalizes every junction on the corridor (the baseline has none)', () => {
    const scene = createScene(0.6);
    expect(scene.signals.every((s) => s === null)).toBe(true);

    greenWave(scene, 0);
    for (const j of scene.corridors[0].junctions) expect(scene.signals[j]?.enabled).toBe(true);
    expect(scene.coordinated[0]).toBeGreaterThan(0);
  });

  it('staggers the phase offsets downstream (junctions do not all start together)', () => {
    const scene = createScene(0.6);
    greenWave(scene, 0);
    const starts = scene.corridors[0].junctions.map((j) => {
      const s = scene.signals[j]!;
      return `${s.phase}:${s.timeInPhase.toFixed(2)}`;
    });

    expect(starts[0]).toBe('0:0.00');
    expect(new Set(starts).size).toBeGreaterThan(1);
  });

  it('captureConfig → applyConfig reproduces a green wave bit-for-bit', () => {
    const direct = createScene(0.7);
    greenWave(direct, 0);

    const replay = createScene(0.7);
    applyConfig(replay, captureConfig(direct), true);

    step(direct.world, 400);
    step(replay.world, 400);

    for (let i = 0; i < direct.world.agents.capacity; i++) {
      expect(replay.world.agents.s[i]).toBe(direct.world.agents.s[i]);
      expect(replay.world.agents.lane[i]).toBe(direct.world.agents.lane[i]);
    }
    expect(replay.world.metrics.completedTrips).toBe(direct.world.metrics.completedTrips);
  });

  it('changes the scenario signature and clearInterventions undoes it', () => {
    const scene = createScene(0.6);
    greenWave(scene, 0);
    expect(scenarioSignature(scene)).not.toBe(scenarioSignature(createScene(0.6)));

    clearInterventions(scene);
    expect(scene.coordinated.every((s) => s === 0)).toBe(true);
    expect(scene.signals.every((s) => s === null || s.enabled === false)).toBe(true);
  });
});
