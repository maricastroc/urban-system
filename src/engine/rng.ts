/**
 * Deterministic PRNG (mulberry32), threaded as an explicit uint32 state so the RNG is part of
 * the World's plain data — reproducible and worker-transferable, with no hidden closure state.
 *
 * Returns the value drawn in [0, 1) and the next state to store back on the World.
 */
export function nextRandom(state: number): { state: number; value: number } {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: s, value };
}
