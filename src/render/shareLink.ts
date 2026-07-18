import { closeLane, setIncident } from '@/engine';
import {
  setSourceRate,
  flipPriority,
  toggleSignal,
  applyRoutes,
  type Scene,
} from './scene';

/**
 * Shareable-link serialization (§24). A scenario is the full experimentation
 * overlay — per-entry demand + destinations, closures, incidents, priority
 * flips, signals — captured against the engine's fixed seed and grid. Because
 * `createScene` bakes in a constant `SEED` and `GRID`, lane and junction ids are
 * stable across loads, so we can serialize the overlay *semantically* (which
 * lanes/junctions, not raw typed arrays) and rebuild it by replaying the same
 * `scene.ts` helpers the UI uses. That keeps the payload tiny, URL-safe, and
 * byte-identical to a hand-built scene.
 *
 * Format (all values are non-negative integers, so the string uses only
 * RFC-3986 unreserved characters — no percent-encoding needed):
 *
 *   payload := "1" ("~" field)*
 *   field   := key body            key ∈ {d,x,c,i,f,g}
 *   body    := item ("." item)*
 *
 *   d  demand     one int (uniform) OR one per source, as round(rate*10)
 *   x  dests      per source: "<src>_<sink>-<sink>…" (disabled destinations only)
 *   c  closed     lane ids
 *   i  incidents  "<lane>_<s10>"  (s10 = round(s*10))
 *   f  flips      junction ids with flipped give-way priority
 *   g  signals    signalized junction ids
 *
 * Only non-empty fields are emitted, in a fixed order, so the encoding is
 * deterministic. Anything malformed decodes to `null` (→ the default scene).
 */

/** URL query param that carries an encoded scenario. */
export const SCENARIO_PARAM = 's';

const VERSION = '1';

export interface SharedScenario {
  /** Per-source demand rate. A single element means uniform across all sources. */
  readonly rates: number[];
  /** Per-source destinations removed from the default "all reachable" set. */
  readonly destinations: { readonly src: number; readonly disabled: number[] }[];
  /** Closed lane ids. */
  readonly closed: number[];
  /** Mid-lane incidents (position in metres). */
  readonly incidents: { readonly lane: number; readonly s: number }[];
  /** Junctions with flipped give-way priority. */
  readonly flips: number[];
  /** Signalized junctions. */
  readonly signals: number[];
}

function posInt(v: string): number {
  if (!/^\d+$/.test(v)) throw new Error(`not a non-negative integer: ${v}`);
  return parseInt(v, 10);
}

/** Read the current scene's overlay into a compact, URL-safe string. */
export function encodeScenario(scene: Scene): string {
  const control = scene.world.control;
  const conns = scene.world.graph.connections;
  const parts: string[] = [VERSION];

  const rates = scene.sources.map((s) => Math.round(s.rate * 10));
  const uniform = rates.every((r) => r === rates[0]);
  parts.push('d' + (uniform ? String(rates[0] ?? 0) : rates.join('.')));

  const dests: string[] = [];
  scene.sources.forEach((ctl, i) => {
    const disabled = ctl.reachable.filter((sink) => !ctl.allowed.has(sink));
    if (disabled.length) dests.push(`${i}_${disabled.join('-')}`);
  });
  if (dests.length) parts.push('x' + dests.join('.'));

  const closed: number[] = [];
  for (let i = 0; i < control.laneClosed.length; i++) if (control.laneClosed[i]) closed.push(i);
  if (closed.length) parts.push('c' + closed.join('.'));

  const incidents: string[] = [];
  for (let i = 0; i < control.incidentAt.length; i++) {
    if (control.incidentAt[i] < Infinity) incidents.push(`${i}_${Math.round(control.incidentAt[i] * 10)}`);
  }
  if (incidents.length) parts.push('i' + incidents.join('.'));

  const flips: number[] = [];
  scene.junctions.forEach((j, idx) => {
    const flipped = j.approaches.some((ap) => ap.conns.some((c) => control.rank[c] !== conns[c].rank));
    if (flipped) flips.push(idx);
  });
  if (flips.length) parts.push('f' + flips.join('.'));

  const signals: number[] = [];
  scene.signals.forEach((s, idx) => {
    if (s?.enabled) signals.push(idx);
  });
  if (signals.length) parts.push('g' + signals.join('.'));

  return parts.join('~');
}

/** Parse an encoded string back to a scenario, or `null` if it is malformed. */
export function decodeScenario(raw: string | null | undefined): SharedScenario | null {
  if (!raw) return null;
  const parts = raw.split('~');
  if (parts[0] !== VERSION) return null;

  const rates: number[] = [];
  const destinations: { src: number; disabled: number[] }[] = [];
  const closed: number[] = [];
  const incidents: { lane: number; s: number }[] = [];
  let flips: number[] = [];
  let signals: number[] = [];

  try {
    for (let k = 1; k < parts.length; k++) {
      const field = parts[k];
      if (!field) continue;
      const key = field[0];
      const items = field.slice(1).split('.').filter(Boolean);
      if (key === 'd') {
        for (const v of items) rates.push(posInt(v) / 10);
      } else if (key === 'x') {
        for (const g of items) {
          const [src, list] = g.split('_');
          if (list === undefined) throw new Error('bad destination group');
          destinations.push({ src: posInt(src), disabled: list.split('-').filter(Boolean).map(posInt) });
        }
      } else if (key === 'c') {
        for (const v of items) closed.push(posInt(v));
      } else if (key === 'i') {
        for (const it of items) {
          const [lane, s10] = it.split('_');
          if (s10 === undefined) throw new Error('bad incident');
          incidents.push({ lane: posInt(lane), s: posInt(s10) / 10 });
        }
      } else if (key === 'f') {
        flips = items.map(posInt);
      } else if (key === 'g') {
        signals = items.map(posInt);
      }
      //
    }
  } catch {
    return null;
  }

  return { rates, destinations, closed, incidents, flips, signals };
}

/**
 * Replay a decoded scenario onto a *fresh* scene using the same helpers the UI
 * calls, then rebuild routes once. All ids are bounds-checked so a stale or
 * hand-edited link can never index out of the current grid.
 */
export function applyScenario(scene: Scene, sc: SharedScenario): void {
  const control = scene.world.control;
  const destBySrc = new Map(sc.destinations.map((d) => [d.src, d.disabled]));

  scene.sources.forEach((ctl, i) => {
    const rate = sc.rates.length === 1 ? sc.rates[0] : sc.rates[i];
    if (rate !== undefined && rate >= 0) setSourceRate(scene, ctl, rate);
    const disabled = destBySrc.get(i);
    const allowed = new Set(ctl.reachable);
    if (disabled) for (const sink of disabled) allowed.delete(sink);
    ctl.allowed = allowed;
  });

  for (const lane of sc.closed) {
    if (lane >= 0 && lane < control.laneClosed.length) closeLane(control, lane);
  }
  for (const { lane, s } of sc.incidents) {
    if (lane >= 0 && lane < control.incidentAt.length) setIncident(control, lane, s);
  }
  for (const j of sc.flips) {
    if (j >= 0 && j < scene.junctions.length) flipPriority(scene, j);
  }
  for (const j of sc.signals) {
    if (j >= 0 && j < scene.junctions.length && scene.signals[j]?.enabled !== true) toggleSignal(scene, j);
  }

  applyRoutes(scene);
}
