import { describe, expect, it } from 'vitest';
import { advanceFocus, createSimulation, stepSimulation, type Simulation } from '../src/sim/sim';

const DT = 1 / 30;
const SURFACE_PHASES = new Set(['foragerToFood', 'foragerReturning']);

function findSurfaceForager(sim: Simulation) {
  return sim.ants.find((ant) => SURFACE_PHASES.has(ant.phase));
}

/** Runs until at least one forager is out walking the surface (needed to
 * exercise the pause reaction at all), bailing out well before the loop
 * could run away if none ever appears. */
function untilSurfaceForager(sim: Simulation): ReturnType<typeof findSurfaceForager> {
  for (let i = 0; i < 30 * 60 * 5 && !findSurfaceForager(sim); i++) stepSimulation(sim, DT);
  return findSurfaceForager(sim);
}

describe('surface ants pause for a passing beetle (SPEC section 6)', () => {
  it('pauses a surface-walking forager right at the surprise position', () => {
    const sim = createSimulation('acorn');
    advanceFocus(sim, 30);
    const forager = untilSurfaceForager(sim);
    expect(forager).toBeDefined();
    if (!forager) return;

    sim.surfaceSurpriseX = forager.x;
    stepSimulation(sim, DT);
    expect(forager.currentSpeed).toBe(0);
  });

  it('does not pause when the surprise is far away', () => {
    const sim = createSimulation('acorn');
    advanceFocus(sim, 30);
    const forager = untilSurfaceForager(sim);
    expect(forager).toBeDefined();
    if (!forager) return;

    sim.surfaceSurpriseX = forager.x + 500;
    stepSimulation(sim, DT);
    // Either still walking (speed > 0) or it just arrived/changed phase —
    // either way, it must not be the pause path specifically.
    if (SURFACE_PHASES.has(forager.phase)) expect(forager.currentSpeed).toBeGreaterThan(0);
  });

  it('resumes once the surprise moves away', () => {
    const sim = createSimulation('acorn');
    advanceFocus(sim, 30);
    const forager = untilSurfaceForager(sim);
    expect(forager).toBeDefined();
    if (!forager) return;

    sim.surfaceSurpriseX = forager.x;
    stepSimulation(sim, DT);
    expect(forager.currentSpeed).toBe(0);

    sim.surfaceSurpriseX = null;
    stepSimulation(sim, DT);
    if (SURFACE_PHASES.has(forager.phase)) expect(forager.currentSpeed).toBeGreaterThan(0);
  });
});
