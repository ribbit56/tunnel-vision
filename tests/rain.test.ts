import { describe, expect, it } from 'vitest';
import { advanceFocus, createSimulation, stepSimulation, type Simulation } from '../src/sim/sim';

const DT = 1 / 30;

/** A populated colony (several idlers wandering, not just founding) with
 * focus already running — plugging the entrance only ever happens while an
 * idler is between wander legs, so this needs an actual crowd to draw from. */
function populatedSimulation(seed: string): Simulation {
  const sim = createSimulation(seed);
  advanceFocus(sim, 30); // leaves focusRunning true
  return sim;
}

describe('entrance plug/unplug (SPEC section 6 "Rain")', () => {
  it('plugs the entrance with an idle worker once it starts raining', () => {
    const sim = populatedSimulation('acorn');
    expect(sim.entrancePlugged).toBe(false);

    sim.weatherPhase = 'rain';
    sim.rainIntensity = 1;
    // A generous number of ticks: plugging only fires when an ant happens to
    // be between wander legs (idle/movingToTarget/pausing), not instantly.
    let sawPlugging = false;
    for (let i = 0; i < 30 * 30 && !sim.entrancePlugged; i++) {
      stepSimulation(sim, DT);
      if (sim.ants.some((ant) => ant.phase === 'plugEntrance')) sawPlugging = true;
    }

    expect(sawPlugging).toBe(true);
    expect(sim.entrancePlugged).toBe(true);
  });

  it('unplugs again once the rain ends', () => {
    const sim = populatedSimulation('acorn');
    sim.weatherPhase = 'rain';
    sim.rainIntensity = 1;
    for (let i = 0; i < 30 * 30 && !sim.entrancePlugged; i++) stepSimulation(sim, DT);
    expect(sim.entrancePlugged).toBe(true);

    sim.weatherPhase = 'clear';
    sim.rainIntensity = 0;
    for (let i = 0; i < 30 * 30 && sim.entrancePlugged; i++) stepSimulation(sim, DT);

    expect(sim.entrancePlugged).toBe(false);
  });

  it('never has two ants handling the entrance at once', () => {
    const sim = populatedSimulation('acorn');
    sim.weatherPhase = 'rain';
    sim.rainIntensity = 1;
    for (let i = 0; i < 30 * 60; i++) {
      stepSimulation(sim, DT);
      const handling = sim.ants.filter((ant) => ant.phase === 'plugEntrance' || ant.phase === 'unplugEntrance').length;
      expect(handling).toBeLessThanOrEqual(1);
    }
  });
});
