import type { LaneGraph } from './laneGraph';
import type { RouteRef, World } from './world';

export function computeRoute(
  graph: LaneGraph,
  from: number,
  to: number,
  closed?: Uint8Array,
): number[] | null {
  const n = graph.laneCount;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const heap = new MinHeap();

  g[from] = 0;
  heap.push(from, 0);

  while (heap.size > 0) {
    const u = heap.pop();
    if (visited[u]) continue;
    visited[u] = 1;

    for (let c = graph.connStart[u]; c < graph.connEnd[u]; c++) {
      const conn = graph.connections[c];
      const v = conn.toLane;
      if (closed && closed[v] === 1) continue;
      const cost = g[u] + graph.length[u] + conn.length;
      if (cost < g[v]) {
        g[v] = cost;
        prev[v] = u;
        heap.push(v, cost);
      }
    }
  }

  if (g[to] === Infinity) return null;

  const path: number[] = [];
  for (let at = to; at !== -1; at = prev[at]) path.push(at);
  path.reverse();
  return path[0] === from ? path : null;
}

export function addRoute(world: World, lanes: readonly number[]): RouteRef {
  const start = world.routeBuffer.length;
  for (const lane of lanes) world.routeBuffer.push(lane);
  return { start, end: world.routeBuffer.length };
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const item = this.items.pop() as number;
    const key = this.keys.pop() as number;
    const n = this.items.length;
    if (n > 0) {
      this.items[0] = item;
      this.keys[0] = key;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < n && this.keys[l] < this.keys[m]) m = l;
        if (r < n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = ti;
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
  }
}
