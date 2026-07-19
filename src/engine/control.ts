import type { LaneGraph } from './laneGraph';
import type { World } from './world';
import type { ConnectionId, LaneId } from './types';
import { SIGNAL_GREEN, SIGNAL_NONE, SIGNAL_RED } from './constants';

export interface SignalController {
  readonly phases: readonly (readonly ConnectionId[])[];
  readonly phaseDur: readonly number[];
  readonly owned: readonly ConnectionId[];
  phase: number;
  timeInPhase: number;
  enabled: boolean;
}

export interface ScenarioControl {
  readonly laneClosed: Uint8Array;
  readonly incidentAt: Float32Array;
  readonly rank: Int32Array;
  readonly signal: Uint8Array;
  readonly signals: SignalController[];
}

export function createControl(graph: LaneGraph): ScenarioControl {
  const nConn = graph.connections.length;
  const rank = new Int32Array(nConn);
  for (let c = 0; c < nConn; c++) rank[c] = graph.connections[c].rank;
  return {
    laneClosed: new Uint8Array(graph.laneCount),
    incidentAt: new Float32Array(graph.laneCount).fill(Infinity),
    rank,
    signal: new Uint8Array(nConn),
    signals: [],
  };
}

export function closeLane(control: ScenarioControl, lane: LaneId): void {
  control.laneClosed[lane] = 1;
}

export function openLane(control: ScenarioControl, lane: LaneId): void {
  control.laneClosed[lane] = 0;
}

export function setIncident(control: ScenarioControl, lane: LaneId, s: number): void {
  control.incidentAt[lane] = s;
}

export function clearIncident(control: ScenarioControl, lane: LaneId): void {
  control.incidentAt[lane] = Infinity;
}

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

export function createSignal(
  phases: readonly (readonly ConnectionId[])[],
  phaseDur: readonly number[],
  offset = 0,
): SignalController {
  const owned = Array.from(new Set(phases.flat()));
  const cycle = phaseDur.reduce((a, b) => a + b, 0);
  let t = cycle > 0 ? ((offset % cycle) + cycle) % cycle : 0;
  let phase = 0;
  while (phase < phaseDur.length - 1 && t >= phaseDur[phase]) {
    t -= phaseDur[phase];
    phase += 1;
  }
  return { phases, phaseDur, owned, phase, timeInPhase: t, enabled: true };
}

function applySignal(control: ScenarioControl, sc: SignalController): void {
  for (const c of sc.owned) control.signal[c] = SIGNAL_RED;
  for (const c of sc.phases[sc.phase]) control.signal[c] = SIGNAL_GREEN;
}

export function addSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = true;
  control.signals.push(sc);
  applySignal(control, sc);
}

export function disableSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = false;
  for (const c of sc.owned) control.signal[c] = SIGNAL_NONE;
}

export function enableSignal(control: ScenarioControl, sc: SignalController): void {
  sc.enabled = true;
  applySignal(control, sc);
}

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
