'use client';

import { forwardRef, useId, useImperativeHandle, useRef } from 'react';
import { createSeries, pushSample, sparkGeometry } from '@/render/sparkline';

export interface SparkHandle {
  push(v: number): void;
  reset(): void;
}

const W = 62;
const H = 16;
const CAP = 60; // ~60 samples ≈ a rolling 60s window at 1 sample/sim-second

// A tiny live sparkline driven imperatively: the render loop calls `push` (~1 Hz)
// and this writes straight to the SVG, so the trace never triggers a React render.
// `max` fixes the top of the scale (e.g. free-flow speed); omit it to auto-scale.
export const Sparkline = forwardRef<SparkHandle, { color: string; max?: number; className?: string }>(
  function Sparkline({ color, max, className }, ref) {
    const gid = 'spark-' + useId().replace(/:/g, '');
    const series = useRef(createSeries(CAP));
    const areaRef = useRef<SVGPathElement>(null);
    const lineRef = useRef<SVGPolylineElement>(null);
    const dotRef = useRef<SVGCircleElement>(null);

    const draw = () => {
      const g = sparkGeometry(series.current.values, { width: W, height: H, cap: CAP, max });
      lineRef.current?.setAttribute('points', g.line);
      areaRef.current?.setAttribute('d', g.area);
      const dot = dotRef.current;
      if (dot) {
        dot.setAttribute('cx', String(g.head.x));
        dot.setAttribute('cy', String(g.head.y));
        dot.style.opacity = g.empty ? '0' : '1';
      }
    };

    useImperativeHandle(ref, () => ({
      push(v: number) {
        pushSample(series.current, v);
        draw();
      },
      reset() {
        series.current.values = [];
        draw();
      },
    }));

    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path ref={areaRef} d="" fill={`url(#${gid})`} />
        <polyline
          ref={lineRef}
          points=""
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle ref={dotRef} r="1.7" fill={color} style={{ opacity: 0 }} />
      </svg>
    );
  },
);
