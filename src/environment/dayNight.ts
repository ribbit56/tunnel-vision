// Time of day (SPEC section 6 "Day and night"): "a pure function of mode,
// cycle length, session start, and current real time." Deliberately outside
// src/sim/ (CLAUDE.md keeps the sim free of wall-clock reads) but pure in
// its own right — every function here takes the caller's timestamps rather
// than reading Date.now() itself, so it's exercised in tests the same way
// as the rest of the project's timestamp-driven code.
export type DayNightMode = 'compressed' | 'real-time';

export interface DayNightConfig {
  /** Compressed mode's full day length, in real minutes (SPEC: "12, 24, or 48"). */
  compressedCycleMinutes: number;
  /** SPEC: "sessions start at mid-morning" — the hour (0-24) a fresh
   * compressed-mode session opens at, before the cycle starts advancing. */
  sessionStartHour: number;
}

/** Hour of day (0-24, cyclic) for the current moment. Real-time mode follows
 * the visitor's own local clock; compressed mode loops a full day every
 * `compressedCycleMinutes` of real elapsed time since the session began. */
export function computeHourOfDay(mode: DayNightMode, cfg: DayNightConfig, sessionStartMs: number, nowMs: number): number {
  if (mode === 'real-time') {
    const d = new Date(nowMs);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
  const elapsedMinutes = Math.max(0, (nowMs - sessionStartMs) / 60_000);
  const cycleFraction = (elapsedMinutes / cfg.compressedCycleMinutes) % 1;
  return (cfg.sessionStartHour + cycleFraction * 24) % 24;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How deep into night the given hour is: 0 full day, 1 full night, easing
 * smoothly through dusk/dawn. The single source of truth for "is it night
 * right now" — shared by star/firefly visibility (`render/sky.ts`) and the
 * colony's own night-time activity reduction (SPEC: "movement speed × 0.8,
 * fewer foragers, more resting"), so both agree on exactly the same curve. */
export function nightFactorForHour(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  // Full night spans across the midnight wrap (19:30 -> 4:30), so this can't
  // be a single smoothstep across the raw hour value.
  if (h >= 19.5 || h <= 4.5) return 1;
  if (h >= 17.5) return smoothstep(17.5, 19.5, h);
  if (h <= 6.5) return 1 - smoothstep(4.5, 6.5, h);
  return 0;
}
