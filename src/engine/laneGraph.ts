import type { ConnectionId, LaneId, NodeId } from './types';

/**
 * A permitted lane -> lane movement through a node.
 *
 * `rank` (strict priority, unique per node) and `conflicts` (connections whose path
 * crosses this one) belong to the intersection contract. They are stored now but only
 * consumed by the intersection logic of a later Etapa — the foundation just carries them.
 */
export interface Connection {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length: number; // distance crossing the node (m)
  readonly rank: number; // strict priority (unique per node)
  readonly conflicts: readonly ConnectionId[];
}

/**
 * Static road network (design doc §C). Immutable during a run — rebuilt only when the
 * map is edited, which is a V2 concern. Metric/topological only: rendering geometry
 * lives in the render layer, never here, to keep the engine free of render concerns.
 */
export interface LaneGraph {
  readonly laneCount: number;
  readonly length: Float32Array; // per lane: length (m)
  readonly speedLimit: Float32Array; // per lane: speed limit (m/s)
  readonly fromNode: Int32Array; // per lane: origin node
  readonly toNode: Int32Array; // per lane: destination node
  // Outgoing connections stored CSR-style, indexed by lane:
  readonly connStart: Int32Array; // per lane: first index into `connections`
  readonly connEnd: Int32Array; // per lane: one-past-last index into `connections`
  readonly connections: readonly Connection[];
}

export interface LaneSpec {
  readonly length: number;
  readonly speedLimit: number; // m/s
  readonly fromNode: NodeId;
  readonly toNode: NodeId;
}

export interface ConnectionSpec {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length?: number;
  readonly rank?: number;
  readonly conflicts?: readonly ConnectionId[];
}

/**
 * Build the immutable LaneGraph (typed arrays + CSR connections) from a plain
 * description. This is the only place lanes/connections get shaped into their
 * cache-friendly layout, so the rest of the engine reads a stable contract.
 */
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

  // Group connections by fromLane so they can be indexed CSR-style.
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
  const flat: Connection[] = [];
  for (let lane = 0; lane < laneCount; lane++) {
    connStart[lane] = flat.length;
    for (const c of byLane[lane]) {
      flat.push({
        fromLane: c.fromLane,
        toLane: c.toLane,
        length: c.length ?? 0,
        rank: c.rank ?? 0,
        conflicts: c.conflicts ?? [],
      });
    }
    connEnd[lane] = flat.length;
  }

  return { laneCount, length, speedLimit, fromNode, toNode, connStart, connEnd, connections: flat };
}
