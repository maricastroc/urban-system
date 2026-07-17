import type { Scene } from './scene';
import { fitCamera, project, placementAt, type Camera, type LaneGeometry } from './geometry';
import { SIGNAL_GREEN, SIGNAL_RED } from '@/engine';

export interface RenderCar {
  readonly lane: number;
  readonly s: number; // interpolated longitudinal position (m)
  readonly length: number; // vehicle length (m)
  readonly speedFrac: number; // 0 = stopped, 1 = at desired speed
}

/** What the interactive canvas currently has selected or hovered (-1 = none). */
export interface RenderOverlay {
  readonly selectedLane: number;
  readonly hoverLane: number;
  readonly selectedJunction: number;
}

const NO_OVERLAY: RenderOverlay = { selectedLane: -1, hoverLane: -1, selectedJunction: -1 };

/**
 * Draw the whole scene in CSS pixels — roads, the live Scenario-Control overlay (closures,
 * incidents, signals, priority), the cars, and any selection highlight. The caller sets up the
 * device-pixel-ratio transform, so this only ever thinks in CSS pixels.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  cars: readonly RenderCar[],
  overlay: RenderOverlay = NO_OVERLAY,
): void {
  const geom = scene.geometry;
  const control = scene.world.control;
  const n = geom.a.length;
  const cam = fitCamera(geom, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';

  // Selection / hover highlight, drawn under the road so it reads as a glow around it.
  for (let i = 0; i < n; i++) {
    const sel = i === overlay.selectedLane;
    const hov = i === overlay.hoverLane;
    if (!sel && !hov) continue;
    strokeLane(ctx, cam, geom, i, sel ? '#38bdf8' : 'rgba(56,189,248,0.35)', 12 * cam.scale);
  }

  // Road surfaces — closed lanes are drawn as a muted red dashed barrier.
  for (let i = 0; i < n; i++) {
    const closed = control.laneClosed[i] === 1;
    if (closed) {
      strokeLane(ctx, cam, geom, i, 'rgba(120,40,44,0.9)', 6 * cam.scale);
    } else {
      strokeLane(ctx, cam, geom, i, '#171a21', 6 * cam.scale);
    }
  }

  // Centre dashes on open lanes only.
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = Math.max(1, 0.16 * cam.scale);
  ctx.setLineDash([12, 14]);
  for (let i = 0; i < n; i++) {
    if (control.laneClosed[i] === 1) continue;
    const a = project(cam, geom.a[i].x, geom.a[i].y);
    const b = project(cam, geom.b[i].x, geom.b[i].y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Closed-lane barrier stripes at the entrance of each closed lane.
  for (let i = 0; i < n; i++) {
    if (control.laneClosed[i] === 1) drawBarrier(ctx, cam, geom, i);
  }

  // Entry (green) and exit (slate) markers at the perimeter, so they read as clickable.
  for (const ctl of scene.sources) {
    const { ux, uy } = laneDir(cam, geom, ctl.lane);
    const p = project(cam, geom.a[ctl.lane].x, geom.a[ctl.lane].y);
    drawChevron(ctx, p.x, p.y, ux, uy, '#34d399');
  }
  for (const sink of scene.sinks) {
    const p = project(cam, geom.b[sink].x, geom.b[sink].y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Cars.
  for (const c of cars) {
    const p = placementAt(geom, c.lane, c.s);
    const sp = project(cam, p.x, p.y);
    const L = Math.max(6, c.length * cam.scale);
    const W = Math.max(4, 2.2 * cam.scale);
    const color = speedColor(c.speedFrac);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(p.heading);
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    roundedRect(ctx, -L / 2, -W / 2, L, W, Math.min(W * 0.4, 5));
    ctx.fill();
    ctx.restore();
  }

  // Incident markers (a stopped obstruction mid-lane).
  for (let i = 0; i < n; i++) {
    const at = control.incidentAt[i];
    if (at < Infinity) {
      const p = placementAt(geom, i, at);
      drawIncident(ctx, project(cam, p.x, p.y));
    }
  }

  // Junctions: signal heads if signalized, a priority tick otherwise, plus a clickable dot.
  scene.junctions.forEach((j, idx) => {
    const jp = project(cam, j.pos.x, j.pos.y);
    const signalized = scene.signals[idx]?.enabled === true;
    const selected = idx === overlay.selectedJunction;

    if (signalized) {
      for (const ap of j.approaches) {
        const st = control.signal[ap.conns[0]];
        const color = st === SIGNAL_GREEN ? '#22c55e' : st === SIGNAL_RED ? '#ef4444' : '#64748b';
        drawSignalHead(ctx, cam, geom, ap.fromLane, color);
      }
    } else {
      // Priority give-way: mark the major approach with a small white wedge.
      let major = j.approaches[0];
      for (const ap of j.approaches) {
        if (control.rank[ap.conns[0]] > control.rank[major.conns[0]]) major = ap;
      }
      drawPriorityTick(ctx, cam, geom, major.fromLane);
    }

    ctx.beginPath();
    ctx.arc(jp.x, jp.y, selected ? 7 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#38bdf8' : 'rgba(148,163,184,0.5)';
    ctx.fill();
    if (selected) {
      ctx.beginPath();
      ctx.arc(jp.x, jp.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

/** Direction (unit) of a lane and its junction-side endpoint, in screen pixels. */
function laneDir(cam: Camera, geom: LaneGeometry, lane: number) {
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len, end: project(cam, b.x, b.y) };
}

function strokeLane(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
  style: string,
  lineWidth: number,
): void {
  const a = project(cam, geom.a[lane].x, geom.a[lane].y);
  const b = project(cam, geom.b[lane].x, geom.b[lane].y);
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawBarrier(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
): void {
  // A short perpendicular bar near the lane's entrance.
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const mid = project(cam, a.x + dx * 0.5, a.y + dy * 0.5);
  const half = 4 * cam.scale;
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = Math.max(2, 1.4 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(mid.x - uy * half, mid.y + ux * half);
  ctx.lineTo(mid.x + uy * half, mid.y - ux * half);
  ctx.stroke();
}

function drawIncident(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = '#1a1206';
  ctx.lineWidth = 1.5;
  const r = 7;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, r * 0.8);
  ctx.lineTo(-r, r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1a1206';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 1);
  ctx.restore();
}

function drawSignalHead(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
  color: string,
): void {
  const { ux, uy, end } = laneDir(cam, geom, lane);
  const off = 7 * cam.scale;
  const x = end.x - ux * off;
  const y = end.y - uy * off;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3.5, 1.6 * cam.scale), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPriorityTick(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
): void {
  const { ux, uy, end } = laneDir(cam, geom, lane);
  const off = 7 * cam.scale;
  const x = end.x - ux * off;
  const y = end.y - uy * off;
  const half = Math.max(3, 1.2 * cam.scale);
  ctx.strokeStyle = 'rgba(226,232,240,0.8)'; // the major approach's right-of-way tick
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - uy * half, y + ux * half);
  ctx.lineTo(x + uy * half, y - ux * half);
  ctx.stroke();
}

function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  color: string,
): void {
  // A small arrowhead pointing along (ux, uy) — the direction traffic enters.
  const s = 6;
  const px = -uy;
  const py = ux;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + ux * s, y + uy * s);
  ctx.lineTo(x - ux * s + px * s, y - uy * s + py * s);
  ctx.lineTo(x - ux * s - px * s, y - uy * s - py * s);
  ctx.closePath();
  ctx.fill();
}

function speedColor(frac: number): string {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  const hue = 8 + 132 * f; // red (stopped) -> green (free flow)
  return `hsl(${hue} 80% 55%)`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
