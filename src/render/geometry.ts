export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly heading: number; // radians
}

/**
 * Render-side lane geometry: where each lane physically sits in world space (metres).
 * The engine is purely metric (design doc §C), so this mapping lives only in the render layer.
 */
export interface LaneGeometry {
  readonly a: readonly Point[]; // per lane: start point
  readonly b: readonly Point[]; // per lane: end point
}

/** Map (lane, s) -> world position + heading along a straight lane segment. */
export function placementAt(geom: LaneGeometry, lane: number, s: number): Placement {
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1; // equals the lane length for a straight segment
  const t = s / len;
  return { x: a.x + dx * t, y: a.y + dy * t, heading: Math.atan2(dy, dx) };
}

/**
 * A uniform world→screen camera that fits every lane into the canvas (design doc §12). Kept here
 * so both the renderer (world→screen) and the interactive canvas (screen→world hit-testing) share
 * exactly one projection.
 */
export interface Camera {
  readonly scale: number;
  readonly ox: number;
  readonly oy: number;
}

/** Fit all lane geometry into `width` × `height` CSS pixels with a single uniform scale. */
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

/** World metres → screen CSS pixels. */
export function project(cam: Camera, x: number, y: number): Point {
  return { x: cam.ox + x * cam.scale, y: cam.oy + y * cam.scale };
}

/** Screen CSS pixels → world metres (inverse of {@link project}). */
export function unproject(cam: Camera, px: number, py: number): Point {
  return { x: (px - cam.ox) / cam.scale, y: (py - cam.oy) / cam.scale };
}

/**
 * The lane whose segment passes nearest to world point `p`, within `tol` metres, or -1. Used to
 * turn a click into a lane selection (closing a road, dropping an incident). Also returns the
 * fractional position `s` (metres) of the nearest point along that lane.
 */
export function nearestLane(
  geom: LaneGeometry,
  p: Point,
  tol: number,
): { lane: number; s: number } {
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
