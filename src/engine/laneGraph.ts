import type { ConnectionId, LaneId, NodeId } from './types';

export interface Connection {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length: number;
  readonly rank: number;
  readonly conflicts: readonly ConnectionId[];
}

export interface LaneGraph {
  readonly laneCount: number;
  readonly length: Float32Array;
  readonly speedLimit: Float32Array;
  readonly fromNode: Int32Array;
  readonly toNode: Int32Array;
  readonly connStart: Int32Array;
  readonly connEnd: Int32Array;
  readonly connections: readonly Connection[];
}

export interface LaneSpec {
  readonly length: number;
  readonly speedLimit: number;
  readonly fromNode: NodeId;
  readonly toNode: NodeId;
}

export interface ConnectionSpec {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length?: number;
  readonly rank?: number;
  readonly conflicts?: readonly ConnectionId[];
  readonly conflictsWith?: readonly (readonly [LaneId, LaneId])[];
}

export function buildLaneGraph(
  lanes: readonly LaneSpec[],
  connections: readonly ConnectionSpec[] = [],
): LaneGraph {
  const laneCount = lanes.length;
  const length = new Float32Array(laneCount);
  const speedLimit = new Float32Array(laneCount);
  const fromNode = new Int32Array(laneCount);
  const toNode = new Int32Array(laneCount);

  for (let i = 0; i < laneCount; i++) {
    const lane = lanes[i];
    length[i] = lane.length;
    speedLimit[i] = lane.speedLimit;
    fromNode[i] = lane.fromNode;
    toNode[i] = lane.toNode;
  }

  const byLane: ConnectionSpec[][] = Array.from({ length: laneCount }, () => []);
  for (const c of connections) {
    if (c.fromLane < 0 || c.fromLane >= laneCount) {
      throw new Error(`Connection.fromLane out of range: ${c.fromLane}`);
    }
    if (c.toLane < 0 || c.toLane >= laneCount) {
      throw new Error(`Connection.toLane out of range: ${c.toLane}`);
    }
    byLane[c.fromLane].push(c);
  }

  const connStart = new Int32Array(laneCount);
  const connEnd = new Int32Array(laneCount);
  const flat: ConnectionSpec[] = [];
  const indexOf = new Map<number, number>();
  const key = (from: number, to: number) => from * laneCount + to;
  for (let lane = 0; lane < laneCount; lane++) {
    connStart[lane] = flat.length;
    for (const c of byLane[lane]) {
      indexOf.set(key(c.fromLane, c.toLane), flat.length);
      flat.push(c);
    }
    connEnd[lane] = flat.length;
  }

  const connections2: Connection[] = flat.map((c) => {
    const conflicts = [...(c.conflicts ?? [])];
    for (const [from, to] of c.conflictsWith ?? []) {
      const idx = indexOf.get(key(from, to));
      if (idx === undefined) throw new Error(`conflictsWith references missing movement ${from}->${to}`);
      conflicts.push(idx);
    }
    return {
      fromLane: c.fromLane,
      toLane: c.toLane,
      length: c.length ?? 0,
      rank: c.rank ?? 0,
      conflicts,
    };
  });

  return { laneCount, length, speedLimit, fromNode, toNode, connStart, connEnd, connections: connections2 };
}
