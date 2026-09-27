// Structured colony/perf stats (SPEC section 11: "Stats: FPS, sim ms,
// render ms, ant counts by role, open cells vs target, pellets carried").
// Deliberately depends only on sim/environment/config types, none of them
// DOM- or render-touching — `window.__colony`'s type (colonyDebugApi.ts) is
// shared between main.ts's app-side tsconfig and the e2e tests' node-side
// one, and a composite TS project refuses to pull in a file outside a
// program's own `include` list even transitively, so anything reachable from
// here has to already be on both.
import type { SurpriseKind } from '../environment/surprises';
import type { WeatherPhase } from '../environment/weather';
import { targetOpenCells } from '../sim/colony/planner';
import { planner as plannerConfig } from '../config';
import { totalVolumeDug } from '../sim/world';
import type { Simulation } from '../sim/sim';

/** Sim/render/frame timing, filled in by main.ts around its calls to
 * `stepSimulation` and the scene's own render functions (SPEC section 11:
 * "Stats: FPS, sim ms, render ms..."; SPEC section 10's perf budget is
 * "under 4ms render and under 2ms sim per frame"). A plain mutable object
 * rather than a return value, since the dev panel polls it on its own
 * interval rather than every tick. */
export interface SimStats {
  lastStepMs: number;
  avgStepMs: number;
  lastRenderMs: number;
  avgRenderMs: number;
  fps: number;
}

export function createSimStats(): SimStats {
  return { lastStepMs: 0, avgStepMs: 0, lastRenderMs: 0, avgRenderMs: 0, fps: 0 };
}

/** The same figures the dev panel's own text readout shows, as a structured
 * object instead of formatted text — what `window.__colony.getStats()`
 * (SPEC section 11's debug API) hands back to Playwright, and what the
 * panel itself formats for display, so the two never drift apart. */
export interface ColonyStats {
  focusMinutes: number;
  focusRunning: boolean;
  antCount: number;
  roleCounts: { queen: number; digger: number; nurse: number; forager: number; idler: number };
  fps: number;
  lastStepMs: number;
  avgStepMs: number;
  lastRenderMs: number;
  avgRenderMs: number;
  openCells: number;
  targetOpenCells: number;
  chambers: number;
  shafts: number;
  jobsQueued: number;
  brood: number;
  moundCells: number;
  granaryStored: number;
  weatherPhase: WeatherPhase;
  rainIntensity: number;
  entrancePlugged: boolean;
  activeSurprise: SurpriseKind | null;
}

export function computeColonyStats(sim: Simulation, simStats: SimStats): ColonyStats {
  const roleCounts = { queen: 0, digger: 0, nurse: 0, forager: 0, idler: 0 };
  for (const ant of sim.ants) roleCounts[ant.role]++;
  return {
    focusMinutes: sim.focusMinutes,
    focusRunning: sim.focusRunning,
    antCount: sim.ants.length,
    roleCounts,
    fps: simStats.fps,
    lastStepMs: simStats.lastStepMs,
    avgStepMs: simStats.avgStepMs,
    lastRenderMs: simStats.lastRenderMs,
    avgRenderMs: simStats.avgRenderMs,
    openCells: totalVolumeDug(sim.world),
    targetOpenCells: targetOpenCells(sim.focusMinutes, sim.lifecycle.brood.length, plannerConfig),
    chambers: sim.planner.chambers.length,
    shafts: sim.planner.shafts.length,
    jobsQueued: sim.planner.jobs.length,
    brood: sim.lifecycle.brood.length,
    moundCells: sim.mound.totalDeposited,
    granaryStored: sim.foraging.granaryStored,
    weatherPhase: sim.weatherPhase,
    rainIntensity: sim.rainIntensity,
    entrancePlugged: sim.entrancePlugged,
    activeSurprise: sim.activeSurprise,
  };
}
