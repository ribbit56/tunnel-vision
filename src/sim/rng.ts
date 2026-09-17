// Deterministic randomness for the simulation (CLAUDE.md "Determinism").
// Never use Math.random() or Date.now() anywhere under src/sim/ — everything
// here must be a pure function of the session seed and, for streams, a system
// name, so the same seed and the same focus timeline always grow the same
// colony.

export type Rng = () => number;

/**
 * cyrb53: a fast, well-distributed non-cryptographic string hash. Used to
 * turn a seed (plus an optional system name) into a 32-bit integer that seeds
 * a PRNG. Not for security — just needs to spread similar inputs apart so
 * "seed" and "seed::planner" don't produce correlated sequences.
 */
export function hashSeed(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

/** mulberry32: a small, fast 32-bit PRNG. Good enough statistical quality for
 * visual/cosmetic and gameplay randomness at this scale. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates an independent RNG stream for one system, derived from the session
 * seed and the system's name. Two systems seeded from the same session never
 * draw from the same sequence, so adding or changing one system doesn't
 * reshuffle any other (CLAUDE.md "Determinism").
 */
export function createStream(sessionSeed: string, systemName: string): Rng {
  return mulberry32(hashSeed(`${sessionSeed}::${systemName}`));
}
