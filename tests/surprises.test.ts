import { describe, expect, it } from 'vitest';
import type { DayNightConfig } from '../src/environment/dayNight';
import { computeSurpriseState, surfaceWalkerX, type SurpriseConfig } from '../src/environment/surprises';
import type { WeatherConfig } from '../src/environment/weather';

const CFG: SurpriseConfig = {
  gapMinutesMin: 6,
  gapMinutesMax: 12,
  durationSecondsByKind: {
    earthworm: [40, 70],
    beetle: [12, 20],
    butterfly: [15, 25],
    snail: [35, 55],
    fallingLeaf: [20, 30],
    extraFireflies: [90, 150],
  },
  baseWeight: {
    earthworm: 1,
    beetle: 1,
    butterfly: 1,
    snail: 0.6,
    fallingLeaf: 1,
    extraFireflies: 1,
  },
  afterRainWeightBoost: 2.5,
};

const DAY_NIGHT_CFG: DayNightConfig = { compressedCycleMinutes: 24, sessionStartHour: 9 };
const WEATHER_CFG: WeatherConfig = {
  firstRainMinMinutes: 15,
  meanGapMinutes: 45,
  cloudingSecondsMin: 60,
  cloudingSecondsMax: 90,
  rainMinutesMin: 4,
  rainMinutesMax: 8,
  clearingSecondsMin: 80,
  clearingSecondsMax: 100,
};

const SESSION_START = 1_000_000;
const ALL_KINDS = ['earthworm', 'beetle', 'butterfly', 'snail', 'fallingLeaf', 'extraFireflies'];

function atMinutes(seed: string, minutes: number) {
  return computeSurpriseState(seed, CFG, 'compressed', DAY_NIGHT_CFG, WEATHER_CFG, SESSION_START, SESSION_START + minutes * 60_000);
}

describe('computeSurpriseState', () => {
  it('leaves real gaps between occurrences rather than chaining them back to back', () => {
    // Sweep finely enough to catch a short occurrence starting or ending,
    // and track how much of the sweep is actually "something happening" —
    // with gaps of 6-12 minutes and occurrences under 3 minutes, surprises
    // should occupy well under half the timeline.
    let activeSamples = 0;
    let totalSamples = 0;
    for (let m = 0; m <= 8 * 60; m += 0.25) {
      totalSamples++;
      if (atMinutes('acorn', m).active !== null) activeSamples++;
    }
    expect(activeSamples / totalSamples).toBeLessThan(0.5);
  });

  it('reports elapsed/duration consistent with being partway through an occurrence', () => {
    for (let m = 0; m <= 8 * 60; m += 0.5) {
      const state = atMinutes('acorn', m);
      if (state.active) {
        expect(state.elapsedSeconds).toBeGreaterThanOrEqual(0);
        expect(state.elapsedSeconds).toBeLessThan(state.durationSeconds);
        expect(state.durationSeconds).toBeGreaterThan(0);
      } else {
        expect(state.elapsedSeconds).toBe(0);
        expect(state.durationSeconds).toBe(0);
      }
    }
  });

  it('only ever picks a kind from the known rotation', () => {
    for (let m = 0; m <= 8 * 60; m += 0.5) {
      const state = atMinutes('acorn', m);
      if (state.active) expect(ALL_KINDS).toContain(state.active);
    }
  });

  it('is deterministic: same seed and time always gives the same state', () => {
    const a = atMinutes('birch', 123.4);
    const b = atMinutes('birch', 123.4);
    expect(a).toEqual(b);
  });

  it('gives different seeds different schedules', () => {
    const a: string[] = [];
    const b: string[] = [];
    for (let m = 0; m <= 4 * 60; m += 2) {
      a.push(String(atMinutes('acorn', m).active));
      b.push(String(atMinutes('cedar', m).active));
    }
    expect(a.join(',')).not.toBe(b.join(','));
  });

  it('never needs catching up: a huge time jump resolves directly', () => {
    const farFuture = atMinutes('acorn', 60 * 24 * 5);
    expect(farFuture.durationSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('surfaceWalkerX', () => {
  it('is deterministic for the same seed, instance, and elapsed time', () => {
    const a = surfaceWalkerX('acorn', 3, 5, 15, 1600);
    const b = surfaceWalkerX('acorn', 3, 5, 15, 1600);
    expect(a).toBe(b);
  });

  it('never travels backward, even through its mid-walk pause', () => {
    const start = surfaceWalkerX('acorn', 3, 0, 15, 1600);
    let previousDistance = 0;
    for (let t = 0.5; t <= 20; t += 0.5) {
      const distance = Math.abs(surfaceWalkerX('acorn', 3, t, 15, 1600) - start);
      expect(distance).toBeGreaterThanOrEqual(previousDistance - 1e-9);
      previousDistance = distance;
    }
  });
});
