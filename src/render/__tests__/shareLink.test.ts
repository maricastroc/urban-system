import { describe, it, expect } from 'vitest';
import {
  createScene,
  toggleLaneClosed,
  toggleIncident,
  flipPriority,
  toggleSignal,
  greenWave,
  setSourceRate,
  toggleDestination,
  scenarioSignature,
  type Scene,
} from '../scene';
import { encodeScenario, decodeScenario, applyScenario } from '../shareLink';

/** Junctions with two real approaches — the ones a priority flip / signal targets. */
function flippableJunctions(scene: Scene): number[] {
  return scene.junctions
    .map((_, i) => i)
    .filter((i) => {
      const ap = scene.junctions[i].approaches;
      return ap.length >= 2 && ap[0].conns.length > 0 && ap[1].conns.length > 0;
    });
}

/** encode → decode → apply onto a fresh scene, returning that reconstruction. */
function roundTrip(scene: Scene): Scene {
  const decoded = decodeScenario(encodeScenario(scene));
  expect(decoded).not.toBeNull();
  const fresh = createScene(0);
  applyScenario(fresh, decoded!);
  return fresh;
}

describe('shareLink — scenario serialization', () => {
  it('round-trips an untouched default scene', () => {
    const scene = createScene(0.4);
    const back = roundTrip(scene);
    expect(scenarioSignature(back)).toBe(scenarioSignature(scene));
  });

  it('encodes the default demand compactly (uniform rate collapses to one value)', () => {
    const scene = createScene(0.4);
    expect(encodeScenario(scene)).toBe('1~d4');
  });

  it('round-trips a full scenario (demand, destinations, closure, incident, flip, signal)', () => {
    const scene = createScene(0.6);
    const flippable = flippableJunctions(scene);
    expect(flippable.length).toBeGreaterThanOrEqual(2);
    const flipJ = flippable[0];
    const signalJ = flippable[1];

    setSourceRate(scene, scene.sources[0], 1.2);
    setSourceRate(scene, scene.sources[1], 0.5);
    toggleDestination(scene, scene.sources[0], scene.sources[0].reachable[0]);
    toggleLaneClosed(scene, scene.sources[2].lane);
    toggleIncident(scene, scene.sinks[0], 23.7);
    flipPriority(scene, flipJ);
    toggleSignal(scene, signalJ);

    const back = roundTrip(scene);
    expect(scenarioSignature(back)).toBe(scenarioSignature(scene));
  });

  it('preserves per-source demand rates and destination restrictions', () => {
    const scene = createScene(0.6);
    setSourceRate(scene, scene.sources[0], 1.5);
    setSourceRate(scene, scene.sources[1], 0.3);
    const droppedSink = scene.sources[0].reachable[0];
    toggleDestination(scene, scene.sources[0], droppedSink);

    const back = roundTrip(scene);
    expect(back.sources[0].rate).toBeCloseTo(1.5, 6);
    expect(back.sources[1].rate).toBeCloseTo(0.3, 6);
    expect(back.sources[0].allowed.has(droppedSink)).toBe(false);
    expect(back.sources[1].allowed.size).toBe(back.sources[1].reachable.length);
  });

  it('preserves closures, incidents (within 0.1 m), flips and signals on the control overlay', () => {
    const scene = createScene(0.6);
    const flipJ = flippableJunctions(scene)[0];
    const closedLane = scene.sources[1].lane;
    const incidentLane = scene.sinks[1];
    toggleLaneClosed(scene, closedLane);
    toggleIncident(scene, incidentLane, 41.36);
    flipPriority(scene, flipJ);
    const sigJ = flippableJunctions(scene)[1];
    toggleSignal(scene, sigJ);

    const back = roundTrip(scene);
    const c = back.world.control;
    const conns = back.world.graph.connections;
    expect(c.laneClosed[closedLane]).toBe(1);
    expect(c.incidentAt[incidentLane]).toBeCloseTo(41.36, 1);
    expect(back.signals[sigJ]?.enabled).toBe(true);
    const flipped = back.junctions[flipJ].approaches.some((ap) =>
      ap.conns.some((ci) => c.rank[ci] !== conns[ci].rank),
    );
    expect(flipped).toBe(true);
  });

  it('round-trips a green wave (coordination survives; junctions not double-encoded)', () => {
    const scene = createScene(0.6);
    greenWave(scene, 0);

    const encoded = encodeScenario(scene);
    expect(encoded).toContain('w0');

    const back = roundTrip(scene);
    expect(scenarioSignature(back)).toBe(scenarioSignature(scene));
    expect(back.coordinated[0]).toBeGreaterThan(0);
    for (const j of back.corridors[0].junctions) expect(back.signals[j]?.enabled).toBe(true);
  });

  it('a closure changes routing identically after a round-trip', () => {
    const scene = createScene(0.6);
    toggleLaneClosed(scene, scene.sources[0].lane);
    const back = roundTrip(scene);
    expect([...back.world.routeBuffer]).toEqual([...scene.world.routeBuffer]);
  });

  it('rejects malformed payloads', () => {
    expect(decodeScenario('')).toBeNull();
    expect(decodeScenario(null)).toBeNull();
    expect(decodeScenario('garbage')).toBeNull();
    expect(decodeScenario('2~d4')).toBeNull();
    expect(decodeScenario('1~dabc')).toBeNull();
    expect(decodeScenario('1~c1.-2')).toBeNull();
    expect(decodeScenario('1~i5')).toBeNull();
  });

  it('accepts a valid payload and ignores unknown fields', () => {
    const sc = decodeScenario('1~d8~z99~c3');
    expect(sc).not.toBeNull();
    expect(sc!.closed).toEqual([3]);
    expect(sc!.rates).toEqual([0.8]);
  });

  it('bounds-checks stale ids so an out-of-range link never throws', () => {
    const scene = createScene(0.4);
    const before = scenarioSignature(scene);

    applyScenario(scene, {
      rates: [0.4],
      destinations: [],
      closed: [99999],
      incidents: [{ lane: 99999, s: 10 }],
      flips: [99999],
      signals: [99999],
    });
    expect(scenarioSignature(scene)).toBe(before);
  });
});
