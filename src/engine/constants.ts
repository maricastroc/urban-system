import type { VParams } from './types';

export const DT = 0.2;
export const B_MAX = 8.0;
export const STOP_OFFSET = 1.0;
export const T_SAFE = 3.5;
export const V_EPS = 0.1;
export const EPS = 0.05;
export const SPAWN_CLEARANCE = 8;

export const SIGNAL_NONE = 0;
export const SIGNAL_GREEN = 1;
export const SIGNAL_RED = 2;
export const DEFAULT_SIGNAL_SECONDS = 8;

export const DEFAULT_VPARAMS: readonly VParams[] = [
  { v0Factor: 1.0, T: 1.3, s0: 2.0, aMax: 1.2, b: 2.0, length: 4.5, delta: 4 },
];
