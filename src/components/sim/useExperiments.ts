import { useCallback, useRef, useState } from 'react';
import {
  runExperiment,
  captureConfig,
  scenarioSignature,
  type Scene,
  type Stats,
  type ExperimentResult,
} from '@/render/scene';
import { generateCandidates, type SweepRow, type Candidate } from '@/render/optimize';
import { runSweepPool } from './sweepPool';
import type { SimMutation } from './simProtocol';
import type { SimClient } from './simClient';

/** One optimizer sweep screens each candidate over this many ticks (§23/§26). */
const SWEEP_TICKS = 300;

export type SweepResultState = { baseline: Stats; rows: SweepRow[]; sig: string };

/** Map an optimizer candidate to its equivalent worker command. */
function mutationOfCandidate(c: Candidate): SimMutation | null {
  if (c.kind === 'signal') return { type: 'addSignals', junction: c.junction };
  if (c.kind === 'priority') return { type: 'flipPriority', junction: c.junction };
  if (c.kind === 'greenwave' && c.corridor !== undefined) return { type: 'greenWave', corridor: c.corridor };
  return null;
}

export interface UseExperimentsArgs {
  sceneRef: React.RefObject<Scene>;
  simClientRef: React.RefObject<SimClient | null>;
  /** Set true just before a worker mutation the optimizer stages, so the loop's
   *  control-confirmation can refold the sweep signature once it lands. */
  stagePendingRef: React.RefObject<boolean>;
  /** The just-staged junction + timestamp, for the map's one-shot pulse. */
  stagedRef: React.RefObject<{ junction: number; at: number }>;
  mutate: (m: SimMutation) => void;
  bump: () => void;
}

/**
 * The experimentation layer — the product's core loop: a controlled A/B and the
 * optimizer sweep, plus staging a candidate onto the live network. Owns all the
 * experiment/sweep state and its orchestration; the headless replays
 * (`runExperiment`, `runSweepPool`) are grid-agnostic and read the live scene, so
 * they work identically in worker and main-thread modes.
 *
 * `resetExperiments` clears it for a fresh scenario (reset / preset / network swap);
 * `refoldSweepSig` re-stamps the leaderboard's staleness signature after the worker
 * confirms a staged mutation — the main loop calls it via `onStageConfirmed`.
 */
export function useExperiments({
  sceneRef,
  simClientRef,
  stagePendingRef,
  stagedRef,
  mutate,
  bump,
}: UseExperimentsArgs) {
  const sweepingRef = useRef(false);
  const [expResult, setExpResult] = useState<ExperimentResult | null>(null);
  const [expRunning, setExpRunning] = useState(false);
  const [expDuration, setExpDuration] = useState(600);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepProg, setSweepProg] = useState({ done: 0, total: 0 });
  const [sweepResult, setSweepResult] = useState<SweepResultState | null>(null);
  const [stagedNeedsRun, setStagedNeedsRun] = useState(false);

  const runExp = useCallback(() => {
    setExpRunning(true);
    setStagedNeedsRun(false);
    window.setTimeout(() => {
      setExpResult(runExperiment(sceneRef.current, expDuration));
      setExpRunning(false);
    }, 30);
  }, [sceneRef, expDuration]);

  const clearStaged = useCallback(() => {
    mutate({ type: 'clearInterventions' });
    setExpResult(null);
    setStagedNeedsRun(false);
  }, [mutate]);

  const runSweep = useCallback(() => {
    if (sweepingRef.current) return;
    sweepingRef.current = true;
    const scene = sceneRef.current;
    const candidates = generateCandidates(scene);
    const cfg = captureConfig(scene);
    const sig = scenarioSignature(scene);
    setSweepRunning(true);
    setSweepResult(null);
    setSweepProg({ done: 0, total: candidates.length + 1 });
    runSweepPool(cfg, candidates, SWEEP_TICKS, (done, total) => setSweepProg({ done, total })).then(
      ({ baseStats, rows }) => {
        setSweepResult({ baseline: baseStats, rows, sig });
        setSweepRunning(false);
        sweepingRef.current = false;
      },
    );
  }, [sceneRef]);

  const stageCandidate = useCallback(
    (c: Candidate) => {
      const client = simClientRef.current;
      if (client) {
        const m = mutationOfCandidate(c);
        if (m) {
          stagePendingRef.current = true;
          client.mutate(m);
        }
      } else {
        c.apply(sceneRef.current);
        setSweepResult((r) => (r ? { ...r, sig: scenarioSignature(sceneRef.current) } : r));
        bump();
      }
      stagedRef.current = { junction: c.junction, at: performance.now() };
      setStagedNeedsRun(true);
    },
    [simClientRef, stagePendingRef, stagedRef, sceneRef, bump],
  );

  const isCandidateStaged = useCallback(
    (c: Candidate) => {
      const scene = sceneRef.current;
      if (c.kind === 'greenwave') return c.corridor !== undefined && scene.coordinated[c.corridor] > 0;
      if (c.kind === 'signal') return scene.signals[c.junction]?.enabled === true;
      const { rank } = scene.world.control;
      const conns = scene.world.graph.connections;
      return scene.junctions[c.junction].approaches.some((ap) =>
        ap.conns.some((ci) => rank[ci] !== conns[ci].rank),
      );
    },
    [sceneRef],
  );

  /** Re-stamp the sweep leaderboard's staleness signature to the live scene, after a
   *  worker-staged mutation is confirmed. Called by the loop's `onStageConfirmed`. */
  const refoldSweepSig = useCallback(() => {
    setSweepResult((r) => (r ? { ...r, sig: scenarioSignature(sceneRef.current) } : r));
  }, [sceneRef]);

  /** Clear A/B + sweep results for a fresh scenario. */
  const resetExperiments = useCallback(() => {
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
  }, []);

  return {
    expResult,
    expRunning,
    expDuration,
    setExpDuration,
    runExp,
    clearStaged,
    sweepRunning,
    sweepProg,
    sweepResult,
    runSweep,
    stageCandidate,
    isCandidateStaged,
    stagedNeedsRun,
    refoldSweepSig,
    resetExperiments,
  };
}
