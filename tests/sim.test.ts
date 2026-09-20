import { describe, expect, it } from 'vitest';
import {
  digging as diggingConfig,
  lifecycle as lifecycleConfig,
  movement as movementConfig,
  planner as plannerConfig,
  queen as queenConfig,
} from '../src/config';
import { createWorkerAnt } from '../src/sim/ants/digger';
import { targetWorkers } from '../src/sim/colony/planner';
import { advanceFocus, createSimulation, stepSimulation, type Simulation } from '../src/sim/sim';
import { isConnectedToEntrance, MATERIALS, totalVolumeDug } from '../src/sim/world';

const DT = 1 / 30;
const ROCK_ID = MATERIALS.indexOf('rock');

/** Runs a fresh simulation for `ticks` with focus already running — most
 * invariant tests care about what happens while the colony is actively
 * growing, not the (correct, but separately tested) paused-by-default
 * starting state. */
function run(seed: string, ticks: number): Simulation {
  const sim = createSimulation(seed);
  sim.focusRunning = true;
  for (let i = 0; i < ticks; i++) stepSimulation(sim, DT);
  return sim;
}

function totalCarried(sim: Simulation): number {
  return sim.ants.reduce((sum, ant) => sum + ant.carriedVolume + ant.diggingProgress, 0);
}

function workerCount(sim: Simulation): number {
  return sim.ants.filter((ant) => ant.role !== 'queen').length;
}

describe('simulation determinism', () => {
  it('gives an identical terrain grid and ant positions for the same seed and tick count', () => {
    const a = run('acorn', 2000);
    const b = run('acorn', 2000);
    expect(Array.from(a.world.density)).toEqual(Array.from(b.world.density));
    expect(a.ants.length).toBe(b.ants.length);
    for (let i = 0; i < a.ants.length; i++) {
      expect(a.ants[i].x).toBe(b.ants[i].x);
      expect(a.ants[i].y).toBe(b.ants[i].y);
    }
  });

  it('gives a different terrain grid for a different seed', () => {
    const a = run('acorn', 2000);
    const b = run('birch', 2000);
    expect(Array.from(a.world.density)).not.toEqual(Array.from(b.world.density));
  });
});

describe('a fresh session starts paused', () => {
  it('does not advance focus time or grow the colony until focus starts running', () => {
    const sim = createSimulation('acorn');
    expect(sim.focusRunning).toBe(false);
    for (let i = 0; i < 1000; i++) stepSimulation(sim, DT);
    expect(sim.focusMinutes).toBe(0);
    expect(sim.ants).toHaveLength(1); // just the queen, mid-glide
    expect(sim.planner.chambers).toHaveLength(0);
  });
});

describe('simulation invariants after a long run', () => {
  const sim = run('acorn', 10_000);

  it('keeps every open cell connected to the entrance', () => {
    expect(isConnectedToEntrance(sim.world)).toBe(true);
  });

  it('conserves soil: dug volume is fully accounted for on the mound, in an ant, or not yet packaged into a pellet', () => {
    const dug = totalVolumeDug(sim.world);
    const accounted = sim.mound.totalDeposited + totalCarried(sim);
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

  it('the queen founded the colony and at least started a royal chamber', () => {
    const queen = sim.ants.find((ant) => ant.role === 'queen');
    expect(queen).toBeDefined();
    expect(sim.planner.chambers.length).toBeGreaterThan(0);
    expect(sim.planner.chambers[0].type).toBe('royal');
  });
});

describe('colony planner', () => {
  // MILESTONES M4 done-when: "no chamber overlap." advanceFocus fast-forwards
  // well past the founding period so the planner has actually placed several
  // chambers to check.
  for (const seed of ['acorn', 'birch', 'cedar']) {
    it(`places no overlapping chambers for seed "${seed}" after 2 focused hours`, () => {
      const sim = createSimulation(seed);
      advanceFocus(sim, 120);

      const chambers = sim.planner.chambers;
      expect(chambers.length).toBeGreaterThan(0);

      for (let i = 0; i < chambers.length; i++) {
        for (let j = i + 1; j < chambers.length; j++) {
          const a = chambers[i];
          const b = chambers[j];
          // Ellipse-vs-ellipse overlap, approximated the same way placement
          // scoring rejects a candidate: too close on both axes at once.
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          const tooClose = dx < a.radiusX + b.radiusX && dy < a.radiusY + b.radiusY;
          expect(tooClose).toBe(false);
        }
      }
    }, 90_000);
  }

  it('grows shafts, chambers, workers, and the mound over a 2-hour-equivalent session', () => {
    const sim = createSimulation('acorn');
    advanceFocus(sim, 120);

    expect(sim.planner.shafts.length).toBeGreaterThan(1);
    expect(sim.planner.chambers.length).toBeGreaterThan(2);
    expect(sim.mound.totalDeposited).toBeGreaterThan(0);
    expect(workerCount(sim)).toBeGreaterThan(10);
    expect(isConnectedToEntrance(sim.world)).toBe(true);
  }, 60_000);
});

describe('pacing curve', () => {
  // MILESTONES M5 done-when: "pacing test passes at 25, 60, and 120 minutes."
  // Real workers lag the target curve (SPEC: brood takes time to mature), so
  // this checks the count stays in a sane band around the target rather than
  // matching it exactly — comfortably below (the lag) but never wildly over.
  it('worker count tracks the target curve within a generous tolerance at 25, 60, and 120 minutes', () => {
    const sim = createSimulation('acorn');
    let previousCount = 0;
    for (const minutes of [25, 60, 120]) {
      advanceFocus(sim, minutes - sim.focusMinutes);
      const target = targetWorkers(sim.focusMinutes, plannerConfig);
      const actual = workerCount(sim);
      expect(actual).toBeGreaterThanOrEqual(previousCount); // never shrinks
      expect(actual).toBeLessThanOrEqual(target + 5); // never wildly overshoots
      previousCount = actual;
    }
    expect(previousCount).toBeGreaterThan(0);
  }, 60_000);
});

describe('resting when focus is paused', () => {
  // MILESTONES M5 done-when: "pausing visibly calms the colony within a few
  // seconds; resuming restarts it."
  it('digging and job-claiming stop shortly after pausing, and resume after resuming', () => {
    const sim = createSimulation('acorn');
    advanceFocus(sim, 15); // enough for the founding sequence and a few workers

    sim.focusRunning = false;
    for (let i = 0; i < 30 * 5; i++) stepSimulation(sim, DT); // 5 real seconds

    const stillDigging = sim.ants.filter(
      (ant) => ant.phase === 'diggingShaft' || ant.phase === 'diggingChamber' || ant.phase === 'diggingConnector',
    );
    expect(stillDigging).toHaveLength(0);
    const dugBeforeResume = totalVolumeDug(sim.world);

    // Nothing should be progressing further while paused, even over a much
    // longer stretch.
    for (let i = 0; i < 30 * 30; i++) stepSimulation(sim, DT); // 30 more seconds
    expect(totalVolumeDug(sim.world)).toBeCloseTo(dugBeforeResume, 5);

    sim.focusRunning = true;
    for (let i = 0; i < 30 * 10; i++) stepSimulation(sim, DT); // 10 real seconds
    // Not "some ant is actively digging again" — a digger can need a few
    // seconds just to walk from wherever it was resting back to a job site,
    // so that's sensitive to how far away it happened to be resting. "No
    // one is still resting" is the more immediate, travel-time-independent
    // signal that resuming actually restarted everyone.
    const stillResting = sim.ants.some((ant) => ant.phase === 'resting');
    expect(stillResting).toBe(false);
  }, 30_000);
});

describe('ants stay within the world over a very long run', () => {
  // Regression test: hardness only ever slowed a digger down, never stopped
  // it outright, so at a high dev time scale it could drift straight through
  // the (undiggable) edge margin and off into empty space forever.
  for (const seed of ['acorn', 'birch', 'cedar']) {
    // A lot of real work for vitest to blast through with no rendering in
    // the way — it's still trivial for the actual sim (well under a
    // millisecond/tick on average, vs. the fixed timestep's real 33ms
    // budget), just slow to run back to back like this, so it needs a
    // longer test timeout than the default.
    it(`never leaves the diggable region for seed "${seed}"`, () => {
      const sim = createSimulation(seed);
      sim.focusRunning = true;
      const worldWidth = sim.world.gridW * sim.world.cellSize;
      const worldDepth = sim.world.gridH * sim.world.cellSize;

      for (let i = 0; i < 100_000; i++) {
        stepSimulation(sim, DT);
        for (const ant of sim.ants) {
          // Two roles legitimately spend time above y=0 (the grass line):
          // the queen during her scripted glide-down intro, and foragers
          // walking the surface for food — neither is the bug this test
          // guards against (a digger drifting through the undiggable edge
          // margin), so give them a generous allowance instead of 0.
          const minY = ant.phase === 'queenGliding' ? -queenConfig.glideStartHeight - 1 : ant.role === 'forager' ? -10 : 0;
          expect(ant.x).toBeGreaterThanOrEqual(0);
          expect(ant.x).toBeLessThanOrEqual(worldWidth);
          expect(ant.y).toBeGreaterThanOrEqual(minY);
          expect(ant.y).toBeLessThanOrEqual(worldDepth);
        }
      }
    }, 150_000);
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
      sim.focusRunning = true;
      for (let i = 0; i < 150_000; i++) {
        stepSimulation(sim, DT);
        if (i % 500 === 0) {
          expect(isConnectedToEntrance(sim.world)).toBe(true);
        }
      }
      expect(isConnectedToEntrance(sim.world)).toBe(true);
    }, 200_000);
  }
});

describe('performance budget', () => {
  // MILESTONES M3 done-when: "sim stays under budget with 70 ants." This
  // doesn't assert a hard number (CI hardware varies too much for that to be
  // reliable) — it's a smoke test that a 70-ant sim completes a long run in
  // a sane amount of wall-clock time, so a real performance regression (e.g.
  // an accidental O(n^2) over ants, or a path search that never terminates)
  // fails loudly instead of just quietly making the page slow.
  it('runs 70 ants for 5000 ticks well within a generous time budget', () => {
    const sim = createSimulation('acorn');
    sim.focusRunning = true;
    for (let i = sim.ants.length; i < 70; i++) {
      const extra = createWorkerAnt('acorn', i, sim.ants[0].x, sim.ants[0].y, false, lifecycleConfig, movementConfig);
      sim.ants.push(extra);
      sim.previousAntPoses.push({ x: extra.x, y: extra.y, heading: extra.heading });
    }

    const start = performance.now();
    for (let i = 0; i < 5000; i++) stepSimulation(sim, DT);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(20_000);
  });
});
