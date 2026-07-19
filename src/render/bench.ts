/**
 * Phase 0 — scale benchmark harness (framework-free, no DOM).
 *
 * Answers the one question that should decide what we optimize first: as the
 * network grows, which wall do we hit first — the **sim compute** (ms per tick)
 * or the **render draw** (ms per frame)? The sim half is measured headlessly
 * here (`npm run bench`, via `scale.bench.ts`); the render half is measured
 * live in the app's dev perf overlay (`?debug`), because a draw cost only
 * exists in a real browser. Reading both against the two budgets below tells us
 * whether Phase 2 (WebGL) or Phase 3 (Worker) buys the bigger win.
 */
import { run } from '@/engine';
import { createScene, sampleStats, type Scene } from './scene';

export interface ScaleConfig {
  readonly grid: number;
  readonly capacity: number;
  readonly rate: number;
}


export const SIM_HZ = 5;
export const TICK_INTERVAL_MS = 1000 / SIM_HZ;
export const FRAME_BUDGET_MS = 1000 / 60;

export const SCALE_MATRIX: readonly ScaleConfig[] = [
  { grid: 5, capacity: 256, rate: 0.8 },
  { grid: 8, capacity: 1000, rate: 0.8 },
  { grid: 10, capacity: 2000, rate: 0.8 },
  { grid: 12, capacity: 3000, rate: 0.8 },
];

export function warmedScene(cfg: ScaleConfig, warmupTicks = 1500): Scene {
  const scene = createScene(cfg.rate, { grid: cfg.grid, capacity: cfg.capacity });
  run(scene.world, warmupTicks);
  return scene;
}

export function activeAgents(scene: Scene): number {
  return sampleStats(scene.world).cars;
}

export function agentCeiling(n: number, ms: number, budgetMs: number): number {
  if (ms <= 0 || n <= 0) return Infinity;
  return Math.round((n * budgetMs) / ms);
}
