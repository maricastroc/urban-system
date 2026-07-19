import { describe, it, expect } from 'vitest';
import { createScene } from '@/render/scene';
import { PRESETS, centralJunction } from '@/render/presets';

const closedCount = (scene: ReturnType<typeof createScene>) => {
  const a = scene.world.control.laneClosed;
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i];
  return n;
};
const signalCount = (scene: ReturnType<typeof createScene>) =>
  scene.signals.filter((s) => s?.enabled).length;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe('experiment presets', () => {
  it('exposes the roadmap scenarios', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['rush', 'artery', 'signal', 'wave']);
  });

  it('picks a deterministic junction nearest the centre', () => {
    expect(centralJunction(createScene(0))).toBe(centralJunction(createScene(0)));
    const scene = createScene(0);
    const js = scene.junctions;
    const cx = js.reduce((s, j) => s + j.pos.x, 0) / js.length;
    const cy = js.reduce((s, j) => s + j.pos.y, 0) / js.length;
    const chosen = js[centralJunction(scene)].pos;
    const dChosen = (chosen.x - cx) ** 2 + (chosen.y - cy) ** 2;
    for (const j of js) {
      const d = (j.pos.x - cx) ** 2 + (j.pos.y - cy) ** 2;
      expect(d).toBeGreaterThanOrEqual(dChosen - 1e-6);
    }
  });

  it('rush hour is demand-only — no intervention staged', () => {
    expect(preset('rush').stage).toBeUndefined();
    expect(preset('rush').demandRate).toBeGreaterThan(1);
  });

  it('close-the-artery shuts exactly one central road', () => {
    const scene = createScene(0);
    expect(closedCount(scene)).toBe(0);
    preset('artery').stage!(scene);
    expect(closedCount(scene)).toBe(1);
  });

  it('signalize-the-centre enables exactly one signal', () => {
    const scene = createScene(0);
    expect(signalCount(scene)).toBe(0);
    preset('signal').stage!(scene);
    expect(signalCount(scene)).toBe(1);
  });

  it('staging is idempotent — re-applying does not double up', () => {
    const scene = createScene(0);
    preset('artery').stage!(scene);
    preset('artery').stage!(scene);
    expect(closedCount(scene)).toBe(1);
  });

  it('green-wave the artery coordinates one central corridor', () => {
    const scene = createScene(0);
    expect(scene.coordinated.every((s) => s === 0)).toBe(true);
    preset('wave').stage!(scene);
    expect(scene.coordinated.filter((s) => s > 0).length).toBe(1);
    expect(signalCount(scene)).toBeGreaterThanOrEqual(2);
  });

  it('green-wave staging is idempotent', () => {
    const scene = createScene(0);
    preset('wave').stage!(scene);
    const signals = signalCount(scene);
    preset('wave').stage!(scene);
    expect(scene.coordinated.filter((s) => s > 0).length).toBe(1);
    expect(signalCount(scene)).toBe(signals);
  });
});
