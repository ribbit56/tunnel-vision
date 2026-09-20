// Small surprises (SPEC section 6 "Small surprises"): "a seeded schedule
// triggers one surprise every 6 to 12 minutes of real time, at most one
// active at a time, weighted by time of day and weather." Lives beside
// dayNight.ts and weather.ts for the same reason — a pure function of seed
// and real time, so it never needs catching up, just like everything else
// CLAUDE.md calls "environment state."
//
// Root growth (SPEC's table) is deliberately not part of this rotation —
// it's marked "Continuous" in the spec, an always-on ambient animation
// rather than a scheduled occurrence, so `render/surprises.ts` drives it
// directly from elapsed session time instead of reading `SurpriseState`.
import { computeHourOfDay, nightFactorForHour, type DayNightConfig, type DayNightMode } from './dayNight';
import { computeWeatherState, type WeatherConfig } from './weather';
import { createStream, type Rng } from '../sim/rng';

export type SurpriseKind = 'earthworm' | 'beetle' | 'butterfly' | 'snail' | 'fallingLeaf' | 'extraFireflies';

const ROTATION_KINDS: SurpriseKind[] = ['earthworm', 'beetle', 'butterfly', 'snail', 'fallingLeaf', 'extraFireflies'];

export interface SurpriseConfig {
  gapMinutesMin: number;
  gapMinutesMax: number;
  durationSecondsByKind: Record<SurpriseKind, [number, number]>;
  baseWeight: Record<SurpriseKind, number>;
  /** Multiplies earthworm/snail weight when the schedule rolls a surprise
   * during the `clearing` weather phase (SPEC: "more likely after rain"). */
  afterRainWeightBoost: number;
}

export interface SurpriseState {
  active: SurpriseKind | null;
  /** This event's index in the schedule — stable for the whole time it's
   * active, and the seed for the renderer's own per-occurrence RNG stream
   * (start position, path, etc.), so the same seed and timeline always
   * grow the same surprise, same as everything else in the project. */
  instanceId: number;
  /** Seconds into the active surprise (0 if none active). */
  elapsedSeconds: number;
  /** Total seconds this occurrence lasts (0 if none active). */
  durationSeconds: number;
}

interface SurpriseEvent {
  startMinutes: number;
  endMinutes: number;
  kind: SurpriseKind;
}

/**
 * Weighted pick among the rotation (SPEC's table: beetle/butterfly only by
 * day, extra fireflies only at night, earthworm/snail more likely just
 * after rain). Weights blend smoothly with `nightFactor` rather than
 * hard-cutting at a time boundary, the same "nothing snaps" treatment every
 * other day/night-driven system in the project gets — a beetle can still
 * turn up rarely right at dusk, just increasingly unlikely toward full night.
 */
function pickKind(rng: Rng, nightFactor: number, justRained: boolean, cfg: SurpriseConfig): SurpriseKind {
  const weights = ROTATION_KINDS.map((kind) => {
    let w = cfg.baseWeight[kind];
    if (kind === 'beetle' || kind === 'butterfly') w *= 1 - nightFactor;
    if (kind === 'extraFireflies') w *= nightFactor;
    if ((kind === 'earthworm' || kind === 'snail') && justRained) w *= cfg.afterRainWeightBoost;
    // Never fully zero: a rare beetle sighting at night is a "surprise" in
    // its own right, and this keeps the picker from ever having nothing to
    // choose from if every weight above happened to collapse to 0.
    return Math.max(w, 0.001);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < ROTATION_KINDS.length; i++) {
    r -= weights[i];
    if (r <= 0) return ROTATION_KINDS[i];
  }
  return ROTATION_KINDS[ROTATION_KINDS.length - 1];
}

/**
 * Builds every surprise event up through `uptoMinutes`, the same
 * walk-forward-from-session-start approach `weather.ts`'s `buildSchedule`
 * uses and for the same reason (irregular gaps have no closed-form
 * formula). Each event's gap, kind, and duration come from their own
 * `hash(seed + "surprise:...:N")` stream, not one shared running RNG.
 *
 * Picking a kind needs the time-of-day and weather *at that event's own
 * historical moment*, so this calls back into `dayNight.ts`/`weather.ts`
 * once per candidate event. That's cheap at the timescales this app
 * actually runs at (SPEC's "calming to leave open for hours") — a
 * days-long session is still only a few hundred events — but it does mean
 * changing the day-length setting mid-session can retroactively change
 * what an *already brand-new* upcoming pick would have been, the same
 * general "pure function of current settings, recomputed fresh every call"
 * characteristic `weather.ts` already accepts.
 */
function buildSchedule(
  seed: string,
  cfg: SurpriseConfig,
  dayNightMode: DayNightMode,
  dayNightCfg: DayNightConfig,
  weatherCfg: WeatherConfig,
  sessionStartMs: number,
  uptoMinutes: number,
): SurpriseEvent[] {
  const events: SurpriseEvent[] = [];
  let cursor = 0;
  let index = 0;

  while (true) {
    const gapRng = createStream(seed, `surprise:gap:${index}`);
    const startMinutes = cursor + cfg.gapMinutesMin + gapRng() * (cfg.gapMinutesMax - cfg.gapMinutesMin);
    if (startMinutes > uptoMinutes) break;

    const startMs = sessionStartMs + startMinutes * 60_000;
    const hours = computeHourOfDay(dayNightMode, dayNightCfg, sessionStartMs, startMs);
    const nightFactor = nightFactorForHour(hours);
    const weather = computeWeatherState(seed, weatherCfg, sessionStartMs, startMs);

    const kindRng = createStream(seed, `surprise:kind:${index}`);
    const kind = pickKind(kindRng, nightFactor, weather.phase === 'clearing', cfg);

    const durationRng = createStream(seed, `surprise:duration:${index}`);
    const [durMin, durMax] = cfg.durationSecondsByKind[kind];
    const durationMinutes = (durMin + durationRng() * (durMax - durMin)) / 60;

    events.push({ startMinutes, endMinutes: startMinutes + durationMinutes, kind });
    cursor = startMinutes + durationMinutes;
    index++;
  }

  return events;
}

/**
 * Where a beetle/snail is along its walk across the surface (SPEC's beetle:
 * "trundles across, pauses, leaves") — a pure function of the seed and the
 * occurrence's own `instanceId` and elapsed time, so both the renderer (to
 * draw it) and the sim (SPEC: "surface ants pause as a beetle passes," which
 * needs to know where it is) derive the exact same position independently,
 * rather than the render layer computing it and the sim somehow reading
 * render state back (CLAUDE.md keeps that a one-way street).
 */
export function surfaceWalkerX(seed: string, instanceId: number, elapsedSeconds: number, speed: number, worldWidth: number): number {
  const rng = createStream(seed, `surprise:walk:${instanceId}`);
  const startX = rng() * worldWidth * 0.3;
  const direction = rng() < 0.5 ? 1 : -1;
  const pauseAtSeconds = 3 + rng() * 4;
  const pauseSeconds = 1.5;
  const travelled =
    elapsedSeconds <= pauseAtSeconds
      ? elapsedSeconds * speed
      : elapsedSeconds <= pauseAtSeconds + pauseSeconds
        ? pauseAtSeconds * speed
        : (elapsedSeconds - pauseSeconds) * speed;
  return startX + direction * travelled;
}

/** The current surprise, purely as a function of the seed and elapsed real
 * session time — see the file header for why this can afford to rebuild
 * the schedule on every call instead of caching it. */
export function computeSurpriseState(
  seed: string,
  cfg: SurpriseConfig,
  dayNightMode: DayNightMode,
  dayNightCfg: DayNightConfig,
  weatherCfg: WeatherConfig,
  sessionStartMs: number,
  nowMs: number,
): SurpriseState {
  const elapsedMinutes = Math.max(0, (nowMs - sessionStartMs) / 60_000);
  const events = buildSchedule(seed, cfg, dayNightMode, dayNightCfg, weatherCfg, sessionStartMs, elapsedMinutes);
  const current = events[events.length - 1];

  if (!current || elapsedMinutes >= current.endMinutes) {
    return { active: null, instanceId: events.length, elapsedSeconds: 0, durationSeconds: 0 };
  }

  return {
    active: current.kind,
    instanceId: events.length - 1,
    elapsedSeconds: (elapsedMinutes - current.startMinutes) * 60,
    durationSeconds: (current.endMinutes - current.startMinutes) * 60,
  };
}
