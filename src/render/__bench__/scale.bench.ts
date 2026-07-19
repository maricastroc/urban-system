/**
 * Headless sim-compute benchmark — `npm run bench`.
 *
 * Measures steady-state `ms per tick` as the grid/agent count grows, so we can
 * put a number on the compute wall and compare it to the render wall (measured
 * live in the app's `?debug` overlay). Excluded from `npm test` (this is a
 * `.bench.ts`, and the vitest config only includes `*.test.ts`).
 *
 * Each case pre-warms its own world to saturation, then benches a fixed run of
 * `TICKS` ticks; divide vitest's reported mean by `TICKS` for ms/tick.
 */
import { bench } from 'vitest';
import { run } from '@/engine';
import { SCALE_MATRIX, warmedScene, activeAgents } from '../bench';

const TICKS = 40;

for (const cfg of SCALE_MATRIX) {
  const scene = warmedScene(cfg);
  const agents = activeAgents(scene);
  const lanes = scene.world.graph.laneCount;

  bench(
    `grid ${cfg.grid}×${cfg.grid} · ${lanes} lanes · ${agents} agents  (÷${TICKS} = ms/tick)`,
    () => {
      run(scene.world, TICKS);
    },
    { time: 600, warmupIterations: 3 },
  );
}
