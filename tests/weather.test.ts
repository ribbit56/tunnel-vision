import { describe, expect, it } from 'vitest';
import { computeWeatherState, type WeatherConfig } from '../src/environment/weather';

const CFG: WeatherConfig = {
  firstRainMinMinutes: 15,
  meanGapMinutes: 45,
  cloudingSecondsMin: 60,
  cloudingSecondsMax: 60,
  rainMinutesMin: 5,
  rainMinutesMax: 5,
  clearingSecondsMin: 90,
  clearingSecondsMax: 90,
};

const SESSION_START = 1_000_000;

function atMinutes(seed: string, minutes: number) {
  return computeWeatherState(seed, CFG, SESSION_START, SESSION_START + minutes * 60_000);
}

describe('computeWeatherState', () => {
  it('never rains before the configured floor (SPEC: "no earlier than 15 minutes")', () => {
    for (let m = 0; m < CFG.firstRainMinMinutes; m += 1) {
      expect(atMinutes('acorn', m).phase).toBe('clear');
    }
  });

  it('only ever transitions clear -> clouding -> rain -> clearing -> clear, never skipping or reversing', () => {
    const order: Record<string, number> = { clear: 0, clouding: 1, rain: 2, clearing: 3 };
    let sawRain = false;
    let previous = 'clear';
    for (let m = 0; m <= 6 * 60; m += 1) {
      const state = atMinutes('acorn', m);
      if (state.phase === 'rain') sawRain = true;
      if (state.phase !== previous) {
        const validAdvance = order[state.phase] === (order[previous] + 1) % 4;
        expect(validAdvance, `unexpected ${previous} -> ${state.phase} at minute ${m}`).toBe(true);
      }
      expect(state.intensity).toBeGreaterThanOrEqual(0);
      expect(state.intensity).toBeLessThanOrEqual(1);
      previous = state.phase;
    }
    // Mean gap is 45 minutes with a 15-minute floor on the first one — six
    // hours is comfortably enough that at least one rain event must occur,
    // regardless of exactly where this seed's random gaps land.
    expect(sawRain).toBe(true);
  });

  it('holds full intensity throughout rain, and ramps through clouding/clearing', () => {
    // Resets each tracker the moment its phase is freshly entered, so a
    // later clouding/clearing stretch isn't compared against the tail end
    // of an earlier one.
    let previousPhase = 'clear';
    let previousIntensity = 0;
    for (let m = 0; m <= 6 * 60; m += 0.5) {
      const state = atMinutes('acorn', m);
      const freshlyEntered = state.phase !== previousPhase;

      if (state.phase === 'rain') {
        expect(state.intensity).toBe(1);
      } else if (state.phase === 'clouding' && !freshlyEntered) {
        expect(state.intensity).toBeGreaterThanOrEqual(previousIntensity);
      } else if (state.phase === 'clearing' && !freshlyEntered) {
        expect(state.intensity).toBeLessThanOrEqual(previousIntensity);
      }

      previousPhase = state.phase;
      previousIntensity = state.intensity;
    }
  });

  it('is deterministic: same seed and time always gives the same state', () => {
    const a = atMinutes('birch', 123.4);
    const b = atMinutes('birch', 123.4);
    expect(a).toEqual(b);
  });

  it('gives different seeds different schedules', () => {
    const phasesA: string[] = [];
    const phasesB: string[] = [];
    for (let m = 0; m <= 3 * 60; m += 5) {
      phasesA.push(atMinutes('acorn', m).phase);
      phasesB.push(atMinutes('cedar', m).phase);
    }
    expect(phasesA.join(',')).not.toBe(phasesB.join(','));
  });

  it('never needs catching up: a huge time jump resolves directly (CLAUDE.md "environment state is a pure function of time")', () => {
    // A jump equivalent to several days of real time — this must still
    // resolve to a well-formed state without iterating from session start
    // one tick at a time.
    const farFuture = atMinutes('acorn', 60 * 24 * 5);
    expect(['clear', 'clouding', 'rain', 'clearing']).toContain(farFuture.phase);
    expect(farFuture.intensity).toBeGreaterThanOrEqual(0);
    expect(farFuture.intensity).toBeLessThanOrEqual(1);
  });
});
