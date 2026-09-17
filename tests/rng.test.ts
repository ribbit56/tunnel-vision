import { describe, expect, it } from 'vitest';
import { createStream } from '../src/sim/rng';

function draw(rng: () => number, count: number): number[] {
  return Array.from({ length: count }, () => rng());
}

describe('createStream', () => {
  it('gives the same sequence for the same seed and stream name', () => {
    const a = draw(createStream('acorn', 'planner'), 10);
    const b = draw(createStream('acorn', 'planner'), 10);
    expect(a).toEqual(b);
  });

  it('gives a different sequence for a different stream name', () => {
    const planner = draw(createStream('acorn', 'planner'), 10);
    const weather = draw(createStream('acorn', 'weather'), 10);
    expect(planner).not.toEqual(weather);
  });

  it('gives a different sequence for a different seed', () => {
    const acorn = draw(createStream('acorn', 'planner'), 10);
    const birch = draw(createStream('birch', 'planner'), 10);
    expect(acorn).not.toEqual(birch);
  });

  it('produces values in [0, 1)', () => {
    const values = draw(createStream('acorn', 'planner'), 1000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
