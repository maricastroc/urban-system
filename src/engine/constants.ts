import type { VParams } from './types';

// Fixed-step simulation constants (design doc §A/§B).
export const DT = 0.2; // fixed logical timestep (s), decoupled from render
export const B_MAX = 8.0; // emergency deceleration cap (m/s^2)
export const STOP_OFFSET = 1.0; // stop-line setback (m)
export const T_SAFE = 3.5; // accepted time gap at intersections (s)
export const V_EPS = 0.1; // velocity epsilon (m/s)
export const EPS = 0.05; // spatial epsilon (m)
export const SPAWN_CLEARANCE = 8; // metres of clear space at a source needed to admit a car

/**
 * Default vehicle catalog. The array index is the agent's `VehicleType`.
 * Kept tiny for V1 (one generic car); more types can be appended without touching the SoA.
 */
export const DEFAULT_VPARAMS: readonly VParams[] = [
  // 0: generic car
  { v0Factor: 1.0, T: 1.3, s0: 2.0, aMax: 1.2, b: 2.0, length: 4.5, delta: 4 },
];
