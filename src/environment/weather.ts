// Weather (SPEC section 6 "Rain"): "a seeded schedule, a pure function of
// seed and real time." Lives beside dayNight.ts for the same reason
// (CLAUDE.md keeps src/sim/ free of wall-clock reads, but this still has to
// be pure in its own right — every function takes the caller's timestamps).
//
// Unlike day/night's simple repeating cycle, rain events land at irregular
// gaps (SPEC: "mean gap about 45 minutes"), so there's no closed-form
// "what hour is it" formula. Instead each event's gap and durations are
// drawn from their own seeded RNG stream, and `computeWeatherState` walks
// the event list forward from session start until it finds (or passes) the
// current moment. A session's rain events number in the dozens even after
// many hours, so this walk stays cheap enough to redo from scratch on every
// call rather than needing to cache or incrementally advance any state.
import { createStream } from '../sim/rng';

export type WeatherPhase = 'clear' | 'clouding' | 'rain' | 'clearing';

export interface WeatherConfig {
  firstRainMinMinutes: number;
  meanGapMinutes: number;
  cloudingSecondsMin: number;
  cloudingSecondsMax: number;
  rainMinutesMin: number;
  rainMinutesMax: number;
  clearingSecondsMin: number;
  clearingSecondsMax: number;
}

export interface WeatherState {
  phase: WeatherPhase;
  /** 0..1 through the current phase — mainly useful for tests. */
  phaseProgress: number;
  /** 0..1: how hard it's raining right now. Ramps up through `clouding`,
   * holds at 1 through `rain`, ramps back down through `clearing`. Drives
   * cloud cover, rain particle density, and the moisture front. */
  intensity: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface RainEvent {
  cloudingStartMin: number;
  rainStartMin: number;
  clearingStartMin: number;
  clearStartMin: number;
}

/**
 * Builds every rain event up through `uptoMinutes`. Each event's gap and
 * durations come from their own `hash(seed + "weather:event:N")` stream
 * (see `createStream`), not one shared running RNG — so event N's timing
 * never shifts just because an earlier event's random draw changed (the same
 * "each system/feature gets its own stream" rule CLAUDE.md applies to every
 * other seeded system).
 */
function buildSchedule(seed: string, cfg: WeatherConfig, uptoMinutes: number): RainEvent[] {
  const events: RainEvent[] = [];
  let cursor = 0;
  let index = 0;

  while (true) {
    const gapRng = createStream(seed, `weather:gap:${index}`);
    // SPEC: "first rain no earlier than 15 minutes into the session; mean
    // gap about 45 minutes." The very first gap is drawn with that floor
    // built in; later gaps are just uniform around the configured mean.
    const gap =
      index === 0
        ? cfg.firstRainMinMinutes + gapRng() * cfg.meanGapMinutes
        : cfg.meanGapMinutes * (0.5 + gapRng());
    const cloudingStartMin = cursor + gap;
    if (cloudingStartMin > uptoMinutes) break;

    const durationRng = createStream(seed, `weather:duration:${index}`);
    const cloudingSeconds = lerp(cfg.cloudingSecondsMin, cfg.cloudingSecondsMax, durationRng());
    const rainMinutes = lerp(cfg.rainMinutesMin, cfg.rainMinutesMax, durationRng());
    const clearingSeconds = lerp(cfg.clearingSecondsMin, cfg.clearingSecondsMax, durationRng());

    const rainStartMin = cloudingStartMin + cloudingSeconds / 60;
    const clearingStartMin = rainStartMin + rainMinutes;
    const clearStartMin = clearingStartMin + clearingSeconds / 60;

    events.push({ cloudingStartMin, rainStartMin, clearingStartMin, clearStartMin });
    cursor = clearStartMin;
    index++;
  }

  return events;
}

/** The current weather, purely as a function of the seed and elapsed real
 * session time — see the file header for why this can afford to rebuild the
 * schedule on every call instead of caching it. */
export function computeWeatherState(seed: string, cfg: WeatherConfig, sessionStartMs: number, nowMs: number): WeatherState {
  const elapsedMinutes = Math.max(0, (nowMs - sessionStartMs) / 60_000);
  const events = buildSchedule(seed, cfg, elapsedMinutes);
  const current = events[events.length - 1];

  if (!current || elapsedMinutes >= current.clearStartMin) {
    return { phase: 'clear', phaseProgress: 0, intensity: 0 };
  }
  if (elapsedMinutes < current.rainStartMin) {
    const t = (elapsedMinutes - current.cloudingStartMin) / (current.rainStartMin - current.cloudingStartMin);
    return { phase: 'clouding', phaseProgress: t, intensity: smoothstep(0, 1, t) };
  }
  if (elapsedMinutes < current.clearingStartMin) {
    const t = (elapsedMinutes - current.rainStartMin) / (current.clearingStartMin - current.rainStartMin);
    return { phase: 'rain', phaseProgress: t, intensity: 1 };
  }
  const t = (elapsedMinutes - current.clearingStartMin) / (current.clearStartMin - current.clearingStartMin);
  return { phase: 'clearing', phaseProgress: t, intensity: 1 - smoothstep(0, 1, t) };
}
