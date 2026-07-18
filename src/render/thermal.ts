export type RGB = readonly [number, number, number];

export const THERMAL_HOT: RGB = [235, 92, 84];
export const THERMAL_AMBER: RGB = [230, 165, 78];
export const THERMAL_COOL: RGB = [116, 200, 214];
const THERMAL_HEAVY: RGB = [236, 132, 66];
const THERMAL_FREE: RGB = [120, 190, 224];

const STOPS: readonly (readonly [number, RGB])[] = [
  [0.0, THERMAL_HOT],
  [0.26, THERMAL_HEAVY],
  [0.52, THERMAL_AMBER],
  [0.78, THERMAL_COOL],
  [1.0, THERMAL_FREE],
];

export function thermal(t: number): RGB {
  const x = clamp01(t);
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      return mix(c0, c1, (x - t0) / (t1 - t0));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function asphalt(cong: number): string {
  const c = clamp01(cong);

  const col =
    c < 0.66
      ? mix([37, 44, 55], [96, 50, 45], c / 0.66)
      : mix([96, 50, 45], [128, 46, 42], (c - 0.66) / 0.34);
  return rgba(col, 1);
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
