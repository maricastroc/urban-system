import { describe, it, expect } from 'vitest';
import { createScene } from '@/render/scene';
import { generateCandidates, sweepBaseline, sweepCandidate } from '@/render/optimize';

describe('experiment optimizer', () => {
  it('generates signalize + flip-priority per junction and green-wave per corridor', () => {
    const scene = createScene(0.5);
    const cands = generateCandidates(scene);
    expect(cands.length).toBe(scene.junctions.length * 2 + scene.corridors.length);
    expect(cands.filter((c) => c.kind === 'signal').length).toBe(scene.junctions.length);
    expect(cands.filter((c) => c.kind === 'priority').length).toBe(scene.junctions.length);
    expect(cands.filter((c) => c.kind === 'greenwave').length).toBe(scene.corridors.length);
    expect(cands.every((c) => c.junction >= 0 && c.junction < scene.junctions.length)).toBe(true);
  });

  it('measures a green-wave candidate deterministically against the shared baseline', () => {
    const build = () => {
      const scene = createScene(0.8);
      const base = sweepBaseline(scene, 200);
      const wave = generateCandidates(scene).find((c) => c.kind === 'greenwave')!;
      return sweepCandidate(base, wave, 200).stats.completedTrips;
    };
    expect(build()).toBe(build());
  });

  it('is deterministic — identical baseline and candidate deltas across runs', () => {
    const run = () => {
      const scene = createScene(0.8);
      const base = sweepBaseline(scene, 200);
      const row = sweepCandidate(base, generateCandidates(scene)[0], 200);
      return { base: base.stats.completedTrips, trips: row.stats.completedTrips, delta: row.tripsDelta };
    };
    const a = run();
    const b = run();
    expect(a.base).toBe(b.base);
    expect(a.trips).toBe(b.trips);
    expect(a.delta).toBe(b.delta);
  });

  it('measures each candidate against the same baseline (deltas are relative to it)', () => {
    const scene = createScene(0.8);
    const base = sweepBaseline(scene, 200);
    const row = sweepCandidate(base, generateCandidates(scene)[0], 200);
    const expected = (row.stats.completedTrips - base.stats.completedTrips) / base.stats.completedTrips;
    expect(row.tripsDelta).toBeCloseTo(expected, 10);
  });

  it('baseline is demand-only — it ignores interventions already staged on the live scene', () => {
    const scene = createScene(0.8);
    const before = sweepBaseline(scene, 150).stats.completedTrips;
    generateCandidates(scene)[0].apply(scene);
    const after = sweepBaseline(scene, 150).stats.completedTrips;
    expect(after).toBe(before);
  });
});
