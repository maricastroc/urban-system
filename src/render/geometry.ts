export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly heading: number; // radians
}

export interface LaneGeometry {
  readonly a: readonly Point[]; // per lane: start point
  readonly b: readonly Point[]; // per lane: end point
}

export function placementAt(geom: LaneGeometry, lane: number, s: number): Placement {
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = s / len;
  return { x: a.x + dx * t, y: a.y + dy * t, heading: Math.atan2(dy, dx) };
}

// One uniform world→screen camera, shared by the renderer and the canvas hit-testing.
export interface Camera {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

export function fitCamera(geom: LaneGeometry, width: number, height: number, pad = 36): Camera {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < geom.a.length; i++) {
    for (const p of [geom.a[i], geom.b[i]]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * scale) / 2 - minX * scale;
  const oy = (height - spanY * scale) / 2 - minY * scale;
  return { scale, ox, oy };
}

export function project(cam: Camera, x: number, y: number): Point {
  return { x: cam.ox + x * cam.scale, y: cam.oy + y * cam.scale };
}

export function unproject(cam: Camera, px: number, py: number): Point {
  return { x: (px - cam.ox) / cam.scale, y: (py - cam.oy) / cam.scale };
}

// Nearest lane to world point `p` within `tol` metres (lane = -1 if none), plus its position `s`.
export function nearestLane(geom: LaneGeometry, p: Point, tol: number): { lane: number; s: number } {
  let best = -1;
  let bestD = tol;
  let bestS = 0;
  for (let i = 0; i < geom.a.length; i++) {
    const a = geom.a[i];
    const b = geom.b[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
      bestS = t * Math.hypot(dx, dy);
    }
  }
  return { lane: best, s: bestS };
}
