import type { Scene } from './scene';
import { fitCamera, project, placementAt, type LaneGeometry } from './geometry';
import { SIGNAL_GREEN, SIGNAL_RED } from '@/engine';
import {
  thermal,
  asphalt,
  mix,
  rgba,
  clamp,
  clamp01,
  THERMAL_HOT,
  THERMAL_AMBER,
  THERMAL_COOL,
  type RGB,
} from './thermal';

export interface RenderCar {
  readonly id: number;
  readonly key: number;
  readonly lane: number;
  readonly s: number;
  readonly length: number;
  readonly speedFrac: number;
}

export interface RenderOverlay {
  readonly selectedLane: number;
  readonly hoverLane: number;
  readonly selectedJunction: number;
  readonly hoverJunction: number;
  readonly selectedCar: number;
  readonly carRoute: readonly number[];
  readonly carRouteIdx: number;
  readonly now: number;
  /** Junction that was just staged (optimizer/inspector), or -1. Fires a one-shot pulse. */
  readonly stagedJunction: number;
  /** Timestamp (same clock as `now`) when it was staged. */
  readonly stagedAt: number;
}

const NO_OVERLAY: RenderOverlay = {
  selectedLane: -1,
  hoverLane: -1,
  selectedJunction: -1,
  hoverJunction: -1,
  selectedCar: -1,
  carRoute: [],
  carRouteIdx: -1,
  now: 0,
  stagedJunction: -1,
  stagedAt: 0,
};

/** Duration of the one-shot ring that confirms a staged intervention. */
const STAGE_PULSE_MS = 900;

const ACCENT: RGB = [96, 165, 250];
const STOP_EPS = 0.14;

export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  cars: readonly RenderCar[],
  overlay: RenderOverlay = NO_OVERLAY,
): void {
  const geom = scene.geometry;
  const graph = scene.world.graph;
  const control = scene.world.control;
  const n = geom.a.length;
  const cam = fitCamera(geom, width, height);
  const now = overlay.now;

  const load = new Uint16Array(n);
  const sumSF = new Float32Array(n);
  const stopped = new Uint16Array(n);
  for (const c of cars) {
    load[c.lane] += 1;
    sumSF[c.lane] += clamp01(c.speedFrac);
    if (c.speedFrac < STOP_EPS) stopped[c.lane] += 1;
  }
  const meanSF = (lane: number) => (load[lane] ? sumSF[lane] / load[lane] : 1);

  const hasSel = overlay.selectedLane >= 0 || overlay.selectedJunction >= 0 || overlay.carRoute.length > 0;
  const focus = new Set<number>();
  if (overlay.selectedLane >= 0) focus.add(overlay.selectedLane);
  if (overlay.selectedJunction >= 0) {
    for (const ap of scene.junctions[overlay.selectedJunction].approaches) {
      focus.add(ap.fromLane);
      for (const cId of ap.conns) focus.add(graph.connections[cId].toLane);
    }
  }
  for (const lane of overlay.carRoute) focus.add(lane);
  const dimOf = (lane: number) => (hasSel && !focus.has(lane) ? 0.28 : 1);

  const A: Pt[] = new Array(n);
  const B: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = project(cam, geom.a[i].x, geom.a[i].y);
    B[i] = project(cam, geom.b[i].x, geom.b[i].y);
  }

  drawBackdrop(ctx, width, height, now);

  const curbW = 7.4 * cam.scale;
  const roadW = 5 * cam.scale;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = dimOf(i);
    strokeSeg(ctx, A[i], B[i], '#080a0e', curbW);
  }
  for (let i = 0; i < n; i++) {
    const d = dimOf(i);
    if (control.laneClosed[i] === 1) {
      ctx.globalAlpha = d;
      strokeSeg(ctx, A[i], B[i], '#2c1418', roadW);
      continue;
    }
    const cong = load[i] ? 1 - meanSF(i) : 0;

    const congVis = cong * cong * (3 - 2 * cong);
    ctx.globalAlpha = d;
    if (congVis > 0.04) {
      ctx.save();
      ctx.shadowColor = rgba(thermal(1 - congVis), 0.34 * congVis * d);
      ctx.shadowBlur = 6 * congVis;
      strokeSeg(ctx, A[i], B[i], asphalt(congVis), roadW);
      ctx.restore();
    } else {
      strokeSeg(ctx, A[i], B[i], asphalt(0), roadW);
    }
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < n; i++) {
    if (control.laneClosed[i] === 1) continue;
    drawFlow(ctx, A[i], B[i], worldLen(geom, i), meanSF(i), load[i], now, {
      dim: dimOf(i),
      selected: i === overlay.selectedLane,
    });
  }

  for (let i = 0; i < n; i++) if (control.laneClosed[i] === 1) drawBarrier(ctx, A[i], B[i], cam.scale);

  for (const ctl of scene.sources) {
    const d = dir(A[ctl.lane], B[ctl.lane]);
    drawChevron(ctx, A[ctl.lane], d, thermal(1), dimOf(ctl.lane));
  }
  for (const sink of scene.sinks) {
    ctx.globalAlpha = dimOf(sink);
    ring(ctx, B[sink].x, B[sink].y, 3.6, 'rgba(150,163,180,0.5)', 1.6);
  }
  ctx.globalAlpha = 1;

  if (overlay.carRoute.length > 0) drawRoute(ctx, A, B, overlay.carRoute, overlay.carRouteIdx, now);

  for (const c of cars) {
    const p = placementAt(geom, c.lane, c.s);
    const sp = project(cam, p.x, p.y);
    drawCar(ctx, sp, p.heading, Math.max(8, c.length * cam.scale * 1.05), Math.max(4.6, 2.5 * cam.scale), c.speedFrac, dimOf(c.lane));
    if (c.id === overlay.selectedCar) {
      const t = (now / 1400) % 1;
      ring(ctx, sp.x, sp.y, 6 + t * 7, rgba(ACCENT, 0.5 * (1 - t)), 1.6);
      ring(ctx, sp.x, sp.y, 6, rgba(ACCENT, 0.95), 1.5);
    }
  }

  for (let i = 0; i < n; i++) {
    const at = control.incidentAt[i];
    if (at < Infinity) {
      const p = placementAt(geom, i, at);
      drawIncident(ctx, project(cam, p.x, p.y), now);
    }
  }

  scene.junctions.forEach((j, idx) => {
    const jp = project(cam, j.pos.x, j.pos.y);
    let activity = 0;
    let queue = 0;
    for (const ap of j.approaches) {
      activity += load[ap.fromLane];
      queue += stopped[ap.fromLane];
    }
    const stagedT =
      idx === overlay.stagedJunction ? (now - overlay.stagedAt) / STAGE_PULSE_MS : -1;
    drawJunction(ctx, jp, j, control, scene.signals[idx]?.enabled === true, activity, queue, {
      selected: idx === overlay.selectedJunction,
      hovered: idx === overlay.hoverJunction,
      stagedT,
      now,
      A,
      B,
      stopped,
    });
  });

  ctx.globalAlpha = 1;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
  const breathe = 0.5 + 0.5 * Math.sin(now / 3200);
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.72);
  g.addColorStop(0, rgba([16, 21, 30], 1));
  g.addColorStop(0.55, rgba([10, 13, 19], 1));
  g.addColorStop(1, rgba([6, 7, 10], 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const cg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.min(w, h) * 0.5);
  cg.addColorStop(0, rgba([70, 110, 170], 0.05 + 0.02 * breathe));
  cg.addColorStop(1, rgba([70, 110, 170], 0));
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, w, h);

  const step = 27;
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = (h % step) / 2; y < h; y += step)
    for (let x = (w % step) / 2; x < w; x += step) ctx.fillRect(x, y, 1, 1);
}

interface FlowOpts {
  dim: number;
  selected: boolean;
}

function drawFlow(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  wLen: number,
  sf: number,
  load: number,
  now: number,
  o: FlowOpts,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sLen = Math.hypot(dx, dy) || 1;
  const ux = dx / sLen;
  const uy = dy / sLen;

  const count = clamp(Math.round(wLen / 30), 1, 5);
  const vWorld = (o.selected ? 16 : 9) * (0.32 + 0.68 * sf);
  const base = ((now / 1000) * (vWorld / wLen)) % 1;
  const col = o.selected ? ACCENT : thermal(sf);
  const loadNorm = clamp(load / 4, 0, 1);
  const streakA = (o.selected ? 0.72 : 0.15 + 0.14 * loadNorm) * o.dim;
  const tailPx = (o.selected ? 15 : 11) * (0.5 + 0.5 * sf);

  for (let k = 0; k < count; k++) {
    let f = base + k / count;
    f -= Math.floor(f);
    const hx = a.x + dx * f;
    const hy = a.y + dy * f;
    const tx = hx - ux * tailPx;
    const ty = hy - uy * tailPx;

    const grad = ctx.createLinearGradient(tx, ty, hx, hy);
    grad.addColorStop(0, rgba(col, 0));
    grad.addColorStop(1, rgba(col, streakA));
    ctx.strokeStyle = grad;
    ctx.lineWidth = o.selected ? 1.7 : 1;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    if (o.selected) {
      ctx.beginPath();
      ctx.arc(hx, hy, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(col, 0.85);
      ctx.fill();
    }
  }
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  p: Pt,
  heading: number,
  L: number,
  W: number,
  sf: number,
  dim: number,
): void {
  const hue = thermal(clamp01(sf));
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(heading);
  ctx.globalAlpha = dim;
  ctx.shadowBlur = 0;

  if (sf > 0.1) {
    const trail = 4 + 14 * sf;
    const g = ctx.createLinearGradient(-L / 2 - trail, 0, -L / 2, 0);
    g.addColorStop(0, rgba(hue, 0));
    g.addColorStop(1, rgba(hue, 0.26 * dim));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-L / 2, -W * 0.28);
    ctx.lineTo(-L / 2 - trail, -W * 0.08);
    ctx.lineTo(-L / 2 - trail, W * 0.08);
    ctx.lineTo(-L / 2, W * 0.28);
    ctx.closePath();
    ctx.fill();
  }

  roundedRect(ctx, -L / 2, -W / 2, L, W, Math.min(W * 0.5, 3));
  ctx.shadowColor = 'rgba(2,4,8,0.9)';
  ctx.shadowBlur = 5;
  const body = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
  body.addColorStop(0, rgba(mix(hue, [255, 255, 255], 0.32), 1));
  body.addColorStop(1, rgba(mix(hue, [248, 252, 255], 0.85), 1));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = 'rgba(6,10,16,0.8)';
  ctx.stroke();
  ctx.restore();
}

interface JOpts {
  selected: boolean;
  hovered: boolean;
  /** One-shot staged-pulse progress 0→1, or <0 when not staged. */
  stagedT: number;
  now: number;
  A: Pt[];
  B: Pt[];
  stopped: Uint16Array;
}

function drawJunction(
  ctx: CanvasRenderingContext2D,
  jp: Pt,
  j: Scene['junctions'][number],
  control: Scene['world']['control'],
  signalized: boolean,
  activity: number,
  queue: number,
  o: JOpts,
): void {
  const stress = clamp(queue / 6, 0, 1);
  const act = clamp(activity / 8, 0, 1);
  const nodeCol = stress > 0.02 ? thermal(1 - stress) : [150, 163, 180] as RGB;
  const r0 = 3.6;
  const breathe = 0.5 + 0.5 * Math.sin(o.now / 700 + j.pos.x);

  if (act > 0.02 || stress > 0.02) {
    ctx.save();
    ctx.shadowColor = rgba(nodeCol, 0.9);
    ctx.shadowBlur = (6 + 10 * Math.max(act, stress)) * (0.8 + 0.2 * breathe);
    ring(ctx, jp.x, jp.y, r0 + 0.6, rgba(nodeCol, 0.5 + 0.4 * stress), 1.4);
    ctx.restore();
  }

  ring(ctx, jp.x, jp.y, r0, rgba(nodeCol, 0.85), 1.5);
  ctx.beginPath();
  ctx.arc(jp.x, jp.y, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = rgba(nodeCol, 0.9);
  ctx.fill();

  for (const ap of j.approaches) {
    const a = o.A[ap.fromLane];
    const b = o.B[ap.fromLane];
    const d = dir(a, b);
    const ix = jp.x - d.x * 8.5;
    const iy = jp.y - d.y * 8.5;
    if (signalized) {
      const st = control.signal[ap.conns[0]];
      const c = st === SIGNAL_GREEN ? THERMAL_COOL : st === SIGNAL_RED ? THERMAL_HOT : [120, 132, 148] as RGB;
      ctx.save();
      ctx.shadowColor = rgba(c, 0.9);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(ix, iy, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = rgba(c, 1);
      ctx.fill();
      ctx.restore();
    } else {
      const qn = clamp(o.stopped[ap.fromLane] / 5, 0, 1);
      if (qn > 0.03) {
        ctx.beginPath();
        ctx.arc(ix, iy, 1.6 + 1.6 * qn, 0, Math.PI * 2);
        ctx.fillStyle = rgba(THERMAL_AMBER, 0.4 + 0.5 * qn);
        ctx.fill();
      }
    }
  }

  if (!signalized) {
    let major = j.approaches[0];
    for (const ap of j.approaches) if (control.rank[ap.conns[0]] > control.rank[major.conns[0]]) major = ap;
    const d = dir(o.A[major.fromLane], o.B[major.fromLane]);
    const px = jp.x - d.x * 8.5;
    const py = jp.y - d.y * 8.5;
    const h = 2.4;
    ctx.strokeStyle = 'rgba(226,232,240,0.55)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px - -d.y * h, py - d.x * h);
    ctx.lineTo(px + -d.y * h, py + d.x * h);
    ctx.stroke();
  }

  if (o.hovered && !o.selected) ring(ctx, jp.x, jp.y, r0 + 3, rgba(ACCENT, 0.45), 1.5);
  if (o.selected) {
    const t = (o.now / 1400) % 1;
    ring(ctx, jp.x, jp.y, r0 + 2 + t * 9, rgba(ACCENT, 0.5 * (1 - t)), 1.6);
    ring(ctx, jp.x, jp.y, r0 + 2.5, rgba(ACCENT, 0.9), 1.6);
  }
  if (o.stagedT >= 0 && o.stagedT <= 1) {
    const s = o.stagedT;
    const ease = 1 - (1 - s) * (1 - s);
    ctx.save();
    ctx.shadowColor = rgba(ACCENT, 0.9);
    ctx.shadowBlur = 10 * (1 - s);
    ring(ctx, jp.x, jp.y, r0 + 2 + ease * 26, rgba(ACCENT, 0.85 * (1 - s)), 2.2 * (1 - 0.5 * s));
    ctx.restore();
  }
}

function drawRoute(ctx: CanvasRenderingContext2D, A: Pt[], B: Pt[], lanes: readonly number[], idx: number, now: number): void {
  ctx.lineCap = 'round';
  for (let k = 0; k < lanes.length; k++) {
    const L = lanes[k];
    const remaining = k >= idx;
    strokeSeg(ctx, A[L], B[L], rgba(ACCENT, remaining ? 0.85 : 0.2), remaining ? 2.6 : 1.6);
  }

  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = -((now / 45) % 12);
  ctx.strokeStyle = rgba([214, 230, 255], 0.9);
  ctx.lineWidth = 1.3;
  for (let k = Math.max(0, idx); k < lanes.length; k++) {
    const L = lanes[k];
    ctx.beginPath();
    ctx.moveTo(A[L].x, A[L].y);
    ctx.lineTo(B[L].x, B[L].y);
    ctx.stroke();
  }
  ctx.restore();

  const dest = B[lanes[lanes.length - 1]];
  const pulse = 0.5 + 0.5 * Math.sin(now / 500);
  ring(ctx, dest.x, dest.y, 4.5 + 2.5 * pulse, rgba(ACCENT, 0.45 * (1 - pulse * 0.5)), 1.6);
  ring(ctx, dest.x, dest.y, 3, rgba(ACCENT, 0.95), 1.8);
}

function strokeSeg(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, style: string, w: number): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: string, lw: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = style;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawBarrier(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, scale: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const mx = a.x + dx * 0.5;
  const my = a.y + dy * 0.5;
  const half = 4 * scale;
  ctx.strokeStyle = '#fb6a68';
  ctx.lineWidth = Math.max(2, 1.4 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - uy * half, my + ux * half);
  ctx.lineTo(mx + uy * half, my - ux * half);
  ctx.stroke();
}

function drawIncident(ctx: CanvasRenderingContext2D, p: Pt, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now / 400);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = '#f4b740';
  ctx.shadowBlur = 8 + 6 * pulse;
  ctx.fillStyle = '#f4b740';
  ctx.strokeStyle = '#1a1206';
  ctx.lineWidth = 1.4;
  const r = 6.5;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, r * 0.8);
  ctx.lineTo(-r, r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.fillStyle = '#1a1206';
  ctx.font = 'bold 8px var(--font-geist-mono), monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 0.5);
  ctx.restore();
}

function drawChevron(ctx: CanvasRenderingContext2D, at: Pt, d: Pt, col: RGB, dim: number): void {
  const s = 5.5;
  const px = -d.y;
  const py = d.x;
  ctx.globalAlpha = dim;
  ctx.fillStyle = rgba(col, 0.9);
  ctx.beginPath();
  ctx.moveTo(at.x + d.x * s, at.y + d.y * s);
  ctx.lineTo(at.x - d.x * s + px * s, at.y - d.y * s + py * s);
  ctx.lineTo(at.x - d.x * s - px * s, at.y - d.y * s - py * s);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

type Pt = { x: number; y: number };

function dir(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function worldLen(geom: LaneGeometry, lane: number): number {
  return Math.hypot(geom.b[lane].x - geom.a[lane].x, geom.b[lane].y - geom.a[lane].y) || 1;
}
