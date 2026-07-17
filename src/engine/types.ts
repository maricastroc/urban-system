// Core id aliases and shared contracts for the simulation engine.
// Ids stay as plain `number` so they can index the typed-array SoA stores directly.

export type AgentId = number;
export type LaneId = number;
export type NodeId = number;
export type ConnectionId = number;
export type VehicleType = number; // index into a VParams catalog

/** Sentinel for "no agent / no connection / frontmost / last". */
export const NONE = -1;

/**
 * Per-vehicle-type IDM parameters (design doc §B).
 *
 * Stored now as part of the contract; only the physics of a later Etapa reads them.
 * The foundation keeps just the `type` index on each agent.
 */
export interface VParams {
  readonly v0Factor: number; // multiplier over the lane speed limit -> desired speed
  readonly T: number; // safe time headway (s)
  readonly s0: number; // minimum jam gap (m)
  readonly aMax: number; // max acceleration (m/s^2)
  readonly b: number; // comfortable deceleration (m/s^2)
  readonly length: number; // vehicle length (m)
  readonly delta: number; // acceleration exponent (= 4)
}
