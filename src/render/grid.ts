import {
  buildLaneGraph,
  connectionFromTo,
  type LaneGraph,
  type ConnectionSpec,
  type LaneSpec,
} from '@/engine';
import type { LaneGeometry, Point } from './geometry';

/** One incoming approach at a junction: its lane and the movements (straight, turn) leaving it. */
export interface JunctionApproach {
  readonly fromLane: number;
  readonly conns: number[]; // connection ids, ordered [straight, turn]
}

/** An intersection, with everything the UI needs to hit-test it and control it. */
export interface Junction {
  readonly node: string;
  readonly pos: Point; // world-space centre (m)
  readonly approaches: JunctionApproach[]; // [H-in, V-in]
}

export interface Grid {
  readonly graph: LaneGraph;
  readonly geometry: LaneGeometry;
  readonly sources: number[]; // perimeter entry lanes
  readonly sinks: number[]; // perimeter exit lanes
  readonly junctions: Junction[]; // interior intersections
}

interface Seg {
  readonly a: Point;
  readonly b: Point;
  readonly axis: 'H' | 'V';
  readonly startNode: string;
  readonly endNode: string;
}

/**
 * Procedurally build a one-way Manhattan grid of `rows` x `cols` intersections. Horizontal
 * streets alternate East/West by row, vertical streets alternate South/North by column, so
 * adjacent streets always run opposite ways. Each street is split into `block`-metre segments
 * (one lane each) plus an entry stub before the grid and an exit stub after it.
 *
 * At every intersection the two incoming streets each connect to the continuing street (straight)
 * and the crossing street (turn). Every movement is given a distinct rank and conflicts with
 * every movement from the *other* incoming lane — an over-declared, collision-free give-way that
 * covers both crossings and merges.
 */
export function buildGrid(rows: number, cols: number, block = 90, speedLimit = 16): Grid {
  const B = block;
  const segs: Seg[] = [];

  const hNode = (r: number, x: number): string =>
    x >= 0 && x <= (cols - 1) * B && x % B === 0 ? `i:${r},${x / B}` : `p:H${r}:${x}`;
  const vNode = (c: number, y: number): string =>
    y >= 0 && y <= (rows - 1) * B && y % B === 0 ? `i:${y / B},${c}` : `p:V${c}:${y}`;

  // Horizontal streets.
  for (let r = 0; r < rows; r++) {
    const east = r % 2 === 0;
    const y = r * B;
    const xs: number[] = [];
    if (east) for (let x = -B; x <= cols * B; x += B) xs.push(x);
    else for (let x = cols * B; x >= -B; x -= B) xs.push(x);
    for (let k = 0; k < xs.length - 1; k++) {
      segs.push({
        a: { x: xs[k], y },
        b: { x: xs[k + 1], y },
        axis: 'H',
        startNode: hNode(r, xs[k]),
        endNode: hNode(r, xs[k + 1]),
      });
    }
  }

  // Vertical streets.
  for (let c = 0; c < cols; c++) {
    const south = c % 2 === 0;
    const x = c * B;
    const ys: number[] = [];
    if (south) for (let y = -B; y <= rows * B; y += B) ys.push(y);
    else for (let y = rows * B; y >= -B; y -= B) ys.push(y);
    for (let k = 0; k < ys.length - 1; k++) {
      segs.push({
        a: { x, y: ys[k] },
        b: { x, y: ys[k + 1] },
        axis: 'V',
        startNode: vNode(c, ys[k]),
        endNode: vNode(c, ys[k + 1]),
      });
    }
  }

  // Assign every distinct node string a stable integer id so the graph is self-describing.
  const nodeIds = new Map<string, number>();
  const nodeId = (name: string): number => {
    let id = nodeIds.get(name);
    if (id === undefined) {
      id = nodeIds.size;
      nodeIds.set(name, id);
    }
    return id;
  };

  const laneSpecs: LaneSpec[] = segs.map((s) => ({
    length: B,
    speedLimit,
    fromNode: nodeId(s.startNode),
    toNode: nodeId(s.endNode),
  }));

  const find = (axis: 'H' | 'V', where: 'start' | 'end', node: string): number =>
    segs.findIndex((s) => s.axis === axis && (where === 'start' ? s.startNode : s.endNode) === node);

  // Interior intersections, captured as we wire their movements so the UI can control them.
  interface JDesc {
    node: string;
    pos: Point;
    hIn: number;
    hOut: number;
    vIn: number;
    vOut: number;
  }
  const jdescs: JDesc[] = [];

  const connSpecs: ConnectionSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const node = `i:${r},${c}`;
      const hIn = find('H', 'end', node);
      const hOut = find('H', 'start', node);
      const vIn = find('V', 'end', node);
      const vOut = find('V', 'start', node);

      const hConflicts: [number, number][] = [
        [vIn, vOut],
        [vIn, hOut],
      ];
      const vConflicts: [number, number][] = [
        [hIn, hOut],
        [hIn, vOut],
      ];
      connSpecs.push({ fromLane: hIn, toLane: hOut, rank: 4, conflictsWith: hConflicts }); // straight
      connSpecs.push({ fromLane: hIn, toLane: vOut, rank: 3, conflictsWith: hConflicts }); // turn
      connSpecs.push({ fromLane: vIn, toLane: vOut, rank: 2, conflictsWith: vConflicts }); // straight
      connSpecs.push({ fromLane: vIn, toLane: hOut, rank: 1, conflictsWith: vConflicts }); // turn
      jdescs.push({ node, pos: { x: c * B, y: r * B }, hIn, hOut, vIn, vOut });
    }
  }

  const graph = buildLaneGraph(laneSpecs, connSpecs);

  // Resolve each junction's connection indices (straight before turn, for a consistent priority
  // swap) now that the CSR layout is fixed.
  const junctions: Junction[] = jdescs.map((j) => ({
    node: j.node,
    pos: j.pos,
    approaches: [
      { fromLane: j.hIn, conns: [connectionFromTo(graph, j.hIn, j.hOut), connectionFromTo(graph, j.hIn, j.vOut)] },
      { fromLane: j.vIn, conns: [connectionFromTo(graph, j.vIn, j.vOut), connectionFromTo(graph, j.vIn, j.hOut)] },
    ],
  }));

  const geometry: LaneGeometry = { a: segs.map((s) => s.a), b: segs.map((s) => s.b) };
  const sources: number[] = [];
  const sinks: number[] = [];
  segs.forEach((s, i) => {
    if (s.startNode.startsWith('p:')) sources.push(i);
    if (s.endNode.startsWith('p:')) sinks.push(i);
  });

  return { graph, geometry, sources, sinks, junctions };
}
