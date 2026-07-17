import type { LaneGraph } from './laneGraph';
import type { World } from './world';
import type { ConnectionId, LaneId } from './types';
import { SIGNAL_GREEN, SIGNAL_NONE, SIGNAL_RED } from './constants';

/**
 * A traffic-signal controller for one junction (design doc §8 — Scenario Control).
 *
 * Plain data + free functions, like the rest of the engine. `phases[p]` is the set of connection
 * ids that are GREEN during phase `p`; every owned connection not in the active phase is RED. The
 * controller round-robins deterministically off the fixed timestep. It is the scene's job to build
 * phases that are mutually conflict-free (all green movements in a phase must not conflict), which
 * makes a signalized junction collision-free without any yield check.
 */
export interface SignalController {
  readonly phases: readonly (readonly ConnectionId[])[]; // connection ids green in each phase
  readonly phaseDur: readonly number[]; // seconds per phase (parallel to `phases`)
  readonly owned: readonly ConnectionId[]; // union of all phases (managed connections)
  phase: number; // active phase index
  timeInPhase: number; // seconds elapsed in the active phase
  enabled: boolean; // false -> junction falls back to priority give-way
}

/**
 * The live experiment overlay on top of the immutable {@link LaneGraph} (design doc §8).
 *
 * Everything the user can change at runtime lives here, as flat typed arrays keyed by lane or
 * connection, so the static graph stays untouched (and worker/WASM-transferable). Defaults reproduce
 * the plain priority network exactly: nothing closed, no incidents, ranks copied from the graph, no
 * signals — so an untouched World behaves as before this layer existed.
 */
export interface ScenarioControl {
  readonly laneClosed: Uint8Array; // per lane: 1 = closed (routing avoids it; its entrance is a wall)
  readonly incidentAt: Float32Array; // per lane: s of a stopped mid-lane obstruction; Infinity = none
  readonly rank: Int32Array; // per connection: effective give-way priority (priority flips mutate this)
  readonly signal: Uint8Array; // per connection: SIGNAL_NONE | SIGNAL_GREEN | SIGNAL_RED
  readonly signals: SignalController[]; // active signal controllers, advanced each tick
}

/** Build the default (all-open, priority-as-authored) control overlay for a graph. */
export function createControl(graph: LaneGraph): ScenarioControl {
  const nConn = graph.connections.length;
  const rank = new Int32Array(nConn);
  for (let c = 0; c < nConn; c++) rank[c] = graph.connections[c].rank;
  return {
    laneClosed: new Uint8Array(graph.laneCount),
    incidentAt: new Float32Array(graph.laneCount).fill(Infinity),
    rank,
    signal: new Uint8Array(nConn), // SIGNAL_NONE everywhere
    signals: [],
  };
}

/** Close a lane: new routes avoid it and cars are held at its entrance until it reopens. */
export function closeLane(control: ScenarioControl, lane: LaneId): void {
  control.laneClosed[lane] = 1;
}

/** Reopen a previously closed lane. */
export function openLane(control: ScenarioControl, lane: LaneId): void {
  control.laneClosed[lane] = 0;
}

/** Drop a stopped obstruction at position `s` on a lane; cars behind it queue, cars past it leave. */
export function setIncident(control: ScenarioControl, lane: LaneId, s: number): void {
  control.incidentAt[lane] = s;
}

/** Clear a lane's incident. */
export function clearIncident(control: ScenarioControl, lane: LaneId): void {
  control.incidentAt[lane] = Infinity;
}

/**
 * Swap the effective priority of two groups of movements (used to flip which approach is major at a
 * junction). The groups must be equal length and ordered consistently (e.g. straight, then turn):
 * ranks are exchanged pairwise, which preserves per-node rank uniqueness (⇒ still deadlock-free).
 */
export function swapRanks(
  control: ScenarioControl,
  a: readonly ConnectionId[],
  b: readonly ConnectionId[],
): void {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const t = control.rank[a[k]];
    control.rank[a[k]] = control.rank[b[k]];
    control.rank[b[k]] = t;
  }
}

/**
 * Create a signal controller. `owned` is derived as the union of all phase groups; the controller
 * starts on phase 0. The scene is responsible for building conflict-free phases.
 */
export function createSignal(
  phases: readonly (readonly ConnectionId[])[],
  phaseDur: readonly number[],
): SignalController {
  const owned = Array.from(new Set(phases.flat()));
  return { phases, phaseDur, owned, phase: 0, timeInPhase: 0, enabled: true };
}

/** Write a controller's current phase into the per-connection signal state. */
function applySignal(control: ScenarioControl, sc: SignalController): void {
  for (const c of sc.owned) control.signal[c] = SIGNAL_RED;
  for (const c of sc.phases[sc.phase]) control.signal[c] = SIGNAL_GREEN;
}

/** Attach a controller to the world and light it immediately (phase 0). */
export function addSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = true;
  control.signals.push(sc);
  applySignal(control, sc);
}

/** Turn a junction back into a priority give-way: disable its controller and clear its state. */
export function disableSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = false;
  for (const c of sc.owned) control.signal[c] = SIGNAL_NONE;
}

/** Re-enable a disabled controller (its phase resumes where it left off). */
export function enableSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = true;
  applySignal(control, sc);
}

/**
 * FASE S — advance every enabled signal controller by one timestep and republish its phase.
 * Deterministic: phase timing is driven purely by the fixed `dt`.
 */
export function updateSignals(world: World): void {
  const { control, dt } = world;
  for (const sc of control.signals) {
    if (!sc.enabled) continue;
    sc.timeInPhase += dt;
    if (sc.timeInPhase >= sc.phaseDur[sc.phase]) {
      sc.timeInPhase = 0;
      sc.phase = (sc.phase + 1) % sc.phases.length;
    }
    applySignal(control, sc);
  }
}
