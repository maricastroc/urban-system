export type AgentId = number;
export type LaneId = number;
export type NodeId = number;
export type ConnectionId = number;
export type VehicleType = number;

export const NONE = -1;

export interface VParams {
  readonly v0Factor: number;
  readonly T: number;
  readonly s0: number;
  readonly aMax: number;
  readonly b: number;
  readonly length: number;
  readonly delta: number;
}
