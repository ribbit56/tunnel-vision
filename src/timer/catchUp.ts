// Catch-up mode (SPEC section 8 "Returning to a hidden tab"): when the tab
// becomes visible again after focus kept "running" while hidden, the colony
// needs to simulate forward through however much focus time it missed. This
// runs the exact same full-fidelity `stepSimulation` used for normal play —
// no separate simplified-movement path — spread across animation frames with
// a small time budget each, so the page stays responsive and shows a brief
// time-lapse instead of freezing on one giant synchronous loop.
//
// Reusing the normal step function keeps catch-up fully deterministic and
// automatically covered by the sim's own invariant tests, at a real cost:
// benchmarked at ~40s of compute to catch up one hour from a mature (~50-ant)
// colony, well past SPEC's "under about 10 seconds" ideal. SPEC's own
// prescribed next step for that is moving the sim into a Web Worker; that's
// a bigger change (every RNG stream in `Simulation` is a closure, which
// can't cross a worker boundary without its own serialize/restore support)
// and hasn't been attempted here — see the M6 report.
import { stepSimulation, type Simulation } from '../sim/sim';

export interface CatchUpConfig {
  /** SPEC: "budget about 8ms of sim per frame." */
  msBudgetPerFrame: number;
  /** SPEC: "cap catch-up at 3 hours of focus time." */
  capMinutes: number;
}

export interface CatchUpRun {
  totalTicks: number;
  ticksDone: number;
  done: boolean;
}

/** Starts a catch-up run for the given number of missed focus-minutes,
 * capped per SPEC. Returns `done: true` immediately for a zero/negligible
 * gap so callers can skip the time-lapse UI entirely. */
export function startCatchUp(minutesMissed: number, cfg: CatchUpConfig, fixedDt: number): CatchUpRun {
  const cappedMinutes = Math.max(0, Math.min(minutesMissed, cfg.capMinutes));
  const totalTicks = Math.round((cappedMinutes * 60) / fixedDt);
  return { totalTicks, ticksDone: 0, done: totalTicks === 0 };
}

/** Runs as many fixed ticks as fit in `msBudget` real milliseconds (a
 * fresh `Date.now`-style budget check per call, not per tick, so the loop
 * doesn't pay a timer read for every single one of a coarse tick). Returns
 * true once the whole run is complete. Safe to keep calling after `done`. */
export function stepCatchUp(run: CatchUpRun, sim: Simulation, fixedDt: number, msBudget: number, nowMs: () => number): boolean {
  if (run.done) return true;
  // Colony growth only advances while `focusRunning` (CLAUDE.md "Two
  // clocks") — a missed gap only ever reaches here because focus *was*
  // conceptually running throughout it, so this just makes that explicit,
  // the same way `advanceFocus` does for the dev panel's jump-focus buttons.
  sim.focusRunning = true;
  const deadline = nowMs() + msBudget;
  // Checking the clock every tick would itself become a meaningful fraction
  // of a sub-millisecond tick's cost; batching the check keeps the budget
  // honest without that overhead.
  const CHECK_EVERY = 32;
  while (run.ticksDone < run.totalTicks) {
    for (let i = 0; i < CHECK_EVERY && run.ticksDone < run.totalTicks; i++) {
      stepSimulation(sim, fixedDt);
      run.ticksDone++;
    }
    if (nowMs() >= deadline) break;
  }
  run.done = run.ticksDone >= run.totalTicks;
  return run.done;
}
