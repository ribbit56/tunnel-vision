import { describe, expect, it } from 'vitest';
import { computeHourOfDay, nightFactorForHour, type DayNightConfig } from '../src/environment/dayNight';

const CFG: DayNightConfig = { compressedCycleMinutes: 24, sessionStartHour: 9 };

describe('computeHourOfDay compressed mode', () => {
  it('starts at the configured session-start hour', () => {
    const start = 1_000_000;
    expect(computeHourOfDay('compressed', CFG, start, start)).toBeCloseTo(9, 5);
  });

  it('advances a full 24h over one compressed cycle', () => {
    const start = 1_000_000;
    const oneCycleLater = start + CFG.compressedCycleMinutes * 60_000;
    // A full cycle wraps back to the same hour (24h elapsed on the clock).
    expect(computeHourOfDay('compressed', CFG, start, oneCycleLater)).toBeCloseTo(9, 4);
  });

  it('is halfway through the day at half a cycle', () => {
    const start = 1_000_000;
    const halfCycleLater = start + (CFG.compressedCycleMinutes / 2) * 60_000;
    expect(computeHourOfDay('compressed', CFG, start, halfCycleLater)).toBeCloseTo(21, 4); // 9 + 12, wraps within 0-24
  });

  it('never needs catching up — a huge time jump still lands correctly (CLAUDE.md "environment state is a pure function of time")', () => {
    const start = 1_000_000;
    const muchLater = start + 137 * CFG.compressedCycleMinutes * 60_000 + 3 * 60_000; // 137 full cycles + 3 minutes
    const expected = (9 + (3 / CFG.compressedCycleMinutes) * 24) % 24;
    expect(computeHourOfDay('compressed', CFG, start, muchLater)).toBeCloseTo(expected, 4);
  });
});

describe('computeHourOfDay real-time mode', () => {
  it('follows the local clock regardless of session start', () => {
    const now = new Date(2024, 0, 1, 14, 30, 0).getTime(); // 14:30 local
    expect(computeHourOfDay('real-time', CFG, 0, now)).toBeCloseTo(14.5, 2);
  });
});

describe('nightFactorForHour', () => {
  it('is 0 at midday', () => {
    expect(nightFactorForHour(12)).toBe(0);
  });

  it('is 1 in the dead of night', () => {
    expect(nightFactorForHour(0)).toBe(1);
    expect(nightFactorForHour(2)).toBe(1);
    expect(nightFactorForHour(22)).toBe(1);
  });

  it('rises smoothly through dusk', () => {
    const at1730 = nightFactorForHour(17.5);
    const at1830 = nightFactorForHour(18.5);
    const at1930 = nightFactorForHour(19.5);
    expect(at1730).toBe(0);
    expect(at1930).toBe(1);
    expect(at1830).toBeGreaterThan(at1730);
    expect(at1830).toBeLessThan(at1930);
  });

  it('falls smoothly through dawn', () => {
    const at0430 = nightFactorForHour(4.5);
    const at0530 = nightFactorForHour(5.5);
    const at0630 = nightFactorForHour(6.5);
    expect(at0430).toBe(1);
    expect(at0630).toBe(0);
    expect(at0530).toBeGreaterThan(0);
    expect(at0530).toBeLessThan(1);
  });

  it('handles the hour wrapping (e.g. 25 same as 1)', () => {
    expect(nightFactorForHour(25)).toBeCloseTo(nightFactorForHour(1), 10);
  });
});
