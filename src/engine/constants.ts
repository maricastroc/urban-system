import type { VParams } from './types';

// Fixed-step simulation constants (design doc §A/§B).
export const DT = 0.2; // fixed logical timestep (s), decoupled from render
export const B_MAX = 8.0; // emergency deceleration cap (m/s^2)
export const STOP_OFFSET = 1.0; // stop-line setback (m)
export const T_SAFE = 3.5; // accepted time gap at intersections (s)
export const V_EPS = 0.1; // velocity epsilon (m/s)
export const EPS = 0.05; // spatial epsilon (m)
export const SPAWN_CLEARANCE = 8; // metres of clear space at a source needed to admit a car

// Per-connection traffic-signal state (design doc §8 — Scenario Control). A connection is either
// unsignalized (priority give-way applies) or held green/red by a SignalController.
export const SIGNAL_NONE = 0; // not signalized -> strict-priority give-way decides
export const SIGNAL_GREEN = 1; // signalized, currently permitted (its conflicts are all red)
export const SIGNAL_RED = 2; // signalized, currently held -> stop at the line
export const DEFAULT_SIGNAL_SECONDS = 8; // default green time per phase (s)

/**
 * Default vehicle catalog. The array index is the agent's `VehicleType`.
 * Kept tiny for V1 (one generic car); more types can be appended without touching the SoA.
 */
export const DEFAULT_VPARAMS: readonly VParams[] = [
  // 0: generic car
  { v0Factor: 1.0, T: 1.3, s0: 2.0, aMax: 1.2, b: 2.0, length: 4.5, delta: 4 },
];
