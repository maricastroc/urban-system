import { describe, it, expect } from 'vitest';
import { createSeries, pushSample, sparkGeometry } from '@/render/sparkline';

describe('SparkSeries ring buffer', () => {
  it('accumulates up to the cap', () => {
    const s = createSeries(3);
    pushSample(s, 1);
    pushSample(s, 2);
    pushSample(s, 3);
    expect(s.values).toEqual([1, 2, 3]);
  });

  it('drops the oldest sample once full', () => {
    const s = createSeries(3);
    [1, 2, 3, 4, 5].forEach((v) => pushSample(s, v));
    expect(s.values).toEqual([3, 4, 5]);
  });
});

describe('sparkGeometry', () => {
  const base = { width: 100, height: 20, cap: 10 };

  it('reports empty with no samples', () => {
    const g = sparkGeometry([], base);
    expect(g.empty).toBe(true);
    expect(g.line).toBe('');
    expect(g.area).toBe('');
  });

  it('pins the newest sample to the right edge', () => {
    const g = sparkGeometry([1, 2, 3], base);
    expect(g.head.x).toBeCloseTo(100);
  });

  it('maps min→baseline and max→top on a fixed scale', () => {
    const g = sparkGeometry([0, 10], { ...base, min: 0, max: 10, pad: 0 });
    expect(g.head.y).toBeCloseTo(0); // newest value 10 → top
  });

  it('clamps values above max to the top (never above)', () => {
    const g = sparkGeometry([100], { ...base, min: 0, max: 10, pad: 0 });
    expect(g.head.y).toBeCloseTo(0);
  });

  it('clamps values below min to the baseline', () => {
    const g = sparkGeometry([-5], { ...base, min: 0, max: 10, pad: 0 });
    expect(g.head.y).toBeCloseTo(20);
  });

  it('auto-scales to the rolling max when max is omitted', () => {
    const g = sparkGeometry([1, 2, 4], { ...base, pad: 0, floor: 1 });
    expect(g.head.y).toBeCloseTo(0); // max = 4, newest = 4 → top
  });

  it('closes the area path back to the baseline', () => {
    const g = sparkGeometry([5, 8], { ...base, min: 0, max: 10, pad: 0 });
    expect(g.area.startsWith('M')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
    expect(g.area).toContain(',20'); // touches the baseline (height - pad)
  });
});
