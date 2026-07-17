'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tick } from '@/engine';
import { createScene, setDemandRate, type Scene } from '@/render/scene';
import { drawScene, type RenderCar } from '@/render/renderer';

const SIM_DT = 0.2; // must match the engine's fixed timestep
const MAX_STEPS = 5; // cap catch-up per frame to avoid a spiral of death
const DEFAULT_DEMAND = 8; // slider units; rate = units * 0.1 cars/second

function unitsToRate(units: number): number {
  return units * 0.1;
}

export function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<HTMLSpanElement>(null);

  const sceneRef = useRef<Scene | null>(null);
  const prevSRef = useRef<Float32Array | null>(null);
  const prevActiveRef = useRef<Uint8Array | null>(null);
  const accRef = useRef(0);
  const lastTsRef = useRef(0);

  const playingRef = useRef(true);
  const speedRef = useRef(1);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(DEFAULT_DEMAND);

  useEffect(() => void (playingRef.current = playing), [playing]);
  useEffect(() => void (speedRef.current = speed), [speed]);

  // Tune demand live on the running scene, no rebuild needed.
  useEffect(() => {
    if (sceneRef.current) setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

  const initScene = useCallback((units: number) => {
    const scene = createScene(unitsToRate(units));
    sceneRef.current = scene;
    prevSRef.current = new Float32Array(scene.world.agents.capacity);
    prevActiveRef.current = new Uint8Array(scene.world.agents.capacity);
    prevSRef.current.set(scene.world.agents.s);
    prevActiveRef.current.set(scene.world.agents.active);
    accRef.current = 0;
  }, []);

  const reset = useCallback(() => initScene(demand), [initScene, demand]);

  useEffect(() => {
    initScene(DEFAULT_DEMAND);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const loop = (ts: number) => {
      const scene = sceneRef.current!;
      const { world } = scene;
      const { agents } = world;
      const prevS = prevSRef.current!;
      const prevActive = prevActiveRef.current!;

      const last = lastTsRef.current || ts;
      let dtReal = (ts - last) / 1000;
      lastTsRef.current = ts;
      if (dtReal > 0.1) dtReal = 0.1; // clamp big gaps (e.g. tab was backgrounded)

      if (playingRef.current) accRef.current += dtReal * speedRef.current;

      let steps = 0;
      while (accRef.current >= SIM_DT && steps < MAX_STEPS) {
        prevS.set(agents.s);
        prevActive.set(agents.active);
        tick(world);
        accRef.current -= SIM_DT;
        steps += 1;
      }
      const alpha = Math.min(accRef.current / SIM_DT, 1);

      const v0 = world.graph.speedLimit[0] * world.vparams[0].v0Factor;
      const cars: RenderCar[] = [];
      let sumV = 0;
      for (let id = 0; id < agents.capacity; id++) {
        if (!agents.active[id]) continue;
        const cur = agents.s[id];
        // Interpolate only cars present in both snapshots; fresh spawns render at their spot.
        const s = prevActive[id] ? prevS[id] + (cur - prevS[id]) * alpha : cur;
        cars.push({
          lane: agents.lane[id],
          s,
          length: world.vparams[agents.type[id]].length,
          speedFrac: agents.v[id] / v0,
        });
        sumV += agents.v[id];
      }

      drawScene(ctx, canvas.clientWidth, canvas.clientHeight, scene, cars);

      if (statsRef.current) {
        const avg = cars.length ? sumV / cars.length : 0;
        statsRef.current.textContent =
          `${cars.length} cars · avg ${(avg * 3.6).toFixed(0)} km/h · ${world.metrics.completedTrips} done`;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [initScene]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-3 shadow-2xl">
        <canvas ref={canvasRef} className="block h-[240px] w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-lg bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={reset}
          className="rounded-lg bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
        >
          Reset
        </button>
        <div className="flex items-center gap-1">
          {[1, 2, 4].map((x) => (
            <button
              key={x}
              onClick={() => setSpeed(x)}
              className={`rounded-lg px-3 py-2 font-medium transition ${
                speed === x
                  ? 'bg-emerald-500 text-black'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {x}×
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-neutral-300">
          Demand
          <input
            type="range"
            min={0}
            max={20}
            value={demand}
            onChange={(e) => setDemand(Number(e.target.value))}
            className="accent-emerald-500"
          />
          <span className="w-16 tabular-nums text-neutral-400">
            {unitsToRate(demand).toFixed(1)}/s
          </span>
        </label>
        <span ref={statsRef} className="ml-auto tabular-nums text-neutral-400" />
      </div>
    </div>
  );
}
