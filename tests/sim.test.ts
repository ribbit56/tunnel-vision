import { describe, expect, it } from 'vitest';
import { digging as diggingConfig } from '../src/config';
import { createSimulation, stepSimulation, type Simulation } from '../src/sim/sim';
import { isConnectedToEntrance, MATERIALS, totalVolumeDug } from '../src/sim/world';

const DT = 1 / 30;
const ROCK_ID = MATERIALS.indexOf('rock');

function run(seed: string, ticks: number): Simulation {
  const sim = createSimulation(seed);
  for (let i = 0; i < ticks; i++) stepSimulation(sim, DT);
  return sim;
}

describe('simulation determinism', () => {
  it('gives an identical terrain grid for the same seed and tick count', () => {
    const a = run('acorn', 2000);
    const b = run('acorn', 2000);
    expect(Array.from(a.world.density)).toEqual(Array.from(b.world.density));
    expect(a.digger.x).toBe(b.digger.x);
    expect(a.digger.y).toBe(b.digger.y);
  });

  it('gives a different terrain grid for a different seed', () => {
    const a = run('acorn', 2000);
    const b = run('birch', 2000);
    expect(Array.from(a.world.density)).not.toEqual(Array.from(b.world.density));
  });
});

describe('simulation invariants after a long run', () => {
  const sim = run('acorn', 4000);

  it('keeps every open cell connected to the entrance', () => {
    expect(isConnectedToEntrance(sim.world)).toBe(true);
  });

  it('conserves soil: dug volume is fully accounted for on the mound, in the ant, or not yet packaged into a pellet', () => {
    const dug = totalVolumeDug(sim.world);
    const accounted =
      sim.mound.totalDeposited + sim.digger.carriedVolume + sim.digger.diggingProgress;
    expect(dug).toBeCloseTo(accounted, 5);
  });

  it('never digs within the edge margin', () => {
    const { gridW, gridH } = sim.world;
    const margin = diggingConfig.edgeMarginCells;
    for (let cy = 0; cy < gridH; cy++) {
      for (let cx = 0; cx < margin; cx++) {
        expect(sim.world.density[cy * gridW + cx]).toBe(1);
        expect(sim.world.density[cy * gridW + (gridW - 1 - cx)]).toBe(1);
      }
    }
    for (let cy = gridH - margin; cy < gridH; cy++) {
      for (let cx = 0; cx < gridW; cx++) {
        expect(sim.world.density[cy * gridW + cx]).toBe(1);
      }
    }
  });

  it('never digs through rock', () => {
    for (let i = 0; i < sim.world.material.length; i++) {
      if (sim.world.material[i] === ROCK_ID) {
        expect(sim.world.density[i]).toBe(1);
      }
    }
  });

  it('carried at least one pellet to the surface', () => {
    expect(sim.mound.totalDeposited).toBeGreaterThan(0);
  });
});

describe('digger stays within the world over a very long run', () => {
  // Regression test: hardness only ever slowed the digger down, never
  // stopped it outright, so at a high dev time scale it could drift straight
  // through the (undiggable) edge margin and off into empty space forever.
  for (const seed of ['acorn', 'birch', 'cedar']) {
    it(`never leaves the diggable region for seed "${seed}"`, () => {
      const sim = createSimulation(seed);
      const worldWidth = sim.world.gridW * sim.world.cellSize;
      const worldDepth = sim.world.gridH * sim.world.cellSize;

      for (let i = 0; i < 100_000; i++) {
        stepSimulation(sim, DT);
        expect(sim.digger.x).toBeGreaterThanOrEqual(0);
        expect(sim.digger.x).toBeLessThanOrEqual(worldWidth);
        expect(sim.digger.y).toBeGreaterThanOrEqual(0);
        expect(sim.digger.y).toBeLessThanOrEqual(worldDepth);
      }
    });
  }
});

describe('branching never leaves an unreachable pocket over a very long run', () => {
  // Regression test: the soft hardness deflection was only ever a nudge, and
  // could lose to the pull back toward a freshly-picked branch's lean angle
  // — the digger would grind straight through a rock formation wider than
  // one nudge could route around (never actually opening it, since rock is
  // skipped), then resume digging normally on the far side. That leaves a
  // real island of open cells with no path back to the entrance. A short
  // run doesn't branch enough to exercise this; this needs a long one.
  for (const seed of ['acorn', 'birch', 'cedar']) {
    it(`keeps every open cell reachable for seed "${seed}"`, () => {
      const sim = createSimulation(seed);
      for (let i = 0; i < 150_000; i++) {
        stepSimulation(sim, DT);
        if (i % 500 === 0) {
          expect(isConnectedToEntrance(sim.world)).toBe(true);
        }
      }
      expect(isConnectedToEntrance(sim.world)).toBe(true);
    });
  }
});
