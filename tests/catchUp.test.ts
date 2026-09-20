import { describe, expect, it } from 'vitest';
import { startCatchUp, stepCatchUp } from '../src/timer/catchUp';
import { createSimulation } from '../src/sim/sim';

const FIXED_DT = 1 / 30;

describe('startCatchUp', () => {
  it('computes the tick count for a missed gap', () => {
    const run = startCatchUp(1, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    expect(run.totalTicks).toBe(Math.round((60 * 1) / FIXED_DT));
    expect(run.done).toBe(false);
  });

  it('is immediately done for a negligible gap', () => {
    const run = startCatchUp(0, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    expect(run.done).toBe(true);
  });

  it('caps at the configured maximum (SPEC: 3 hours)', () => {
    const run = startCatchUp(999, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    expect(run.totalTicks).toBe(Math.round((180 * 60) / FIXED_DT));
  });
});

describe('stepCatchUp', () => {
  it('advances the sim by exactly the missed focus time once fully run', () => {
    const sim = createSimulation('acorn');
    const run = startCatchUp(5, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    // An effectively unlimited budget and a clock that never reports past
    // the deadline — this test cares that a full run reaches the right
    // sim state, not that it respects a real-time budget (that's covered
    // below).
    let clock = 0;
    const nowMs = () => clock;
    while (!stepCatchUp(run, sim, FIXED_DT, 1_000_000, nowMs)) clock += 1;
    expect(sim.focusRunning).toBe(true);
    expect(sim.focusMinutes).toBeCloseTo(5, 5);
  });

  it('stops once the ms budget for this call is spent, resuming on the next call', () => {
    const sim = createSimulation('acorn');
    const run = startCatchUp(60, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    // A fake clock that advances 1ms per read — the loop checks it every 32
    // ticks, so a tiny budget guarantees it stops well short of totalTicks.
    let clock = 0;
    const nowMs = () => clock++;
    const doneAfterOneCall = stepCatchUp(run, sim, FIXED_DT, 1, nowMs);
    expect(doneAfterOneCall).toBe(false);
    expect(run.ticksDone).toBeGreaterThan(0);
    expect(run.ticksDone).toBeLessThan(run.totalTicks);
  });

  it('is a safe no-op once already done', () => {
    const sim = createSimulation('acorn');
    const run = startCatchUp(0, { msBudgetPerFrame: 8, capMinutes: 180 }, FIXED_DT);
    expect(stepCatchUp(run, sim, FIXED_DT, 8, () => 0)).toBe(true);
  });
});
