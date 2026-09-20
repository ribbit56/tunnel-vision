// All colors live here (CLAUDE.md "Visual rules"). Nothing outside this file
// should hard-code a hex value. Values transcribed from docs/SPEC.md section 7.
import { lerp, lerpColor } from './colorMath';

export interface TimeOfDayKeyframe {
  /** Hour of day this keyframe represents (24h clock), for reference only. */
  clock: number;
  skyTop: string;
  skyHorizon: string;
  lightTint: string;
  /** Overall scene brightness multiplier. */
  exposure: number;
}

export const timeOfDay = {
  dawn: { clock: 6, skyTop: '#C9A9B8', skyHorizon: '#F4D3A8', lightTint: '#FFE4C4', exposure: 0.9 },
  day: { clock: 12, skyTop: '#A9CFD8', skyHorizon: '#EEE7CF', lightTint: '#FFF8EC', exposure: 1.0 },
  dusk: { clock: 18.5, skyTop: '#8C7BA6', skyHorizon: '#EDA774', lightTint: '#F6C79A', exposure: 0.85 },
  night: { clock: 0, skyTop: '#1E2640', skyHorizon: '#3C4868', lightTint: '#9AA8D0', exposure: 0.55 },
} as const satisfies Record<string, TimeOfDayKeyframe>;

export const surface = {
  grassLight: '#9BB36A',
  grassMid: '#7A9A52',
  grassDark: '#5C7A42',
  flowerAccents: ['#E8C27A', '#D98C7A', '#F3EAD6'],
  moundSettled: '#A07B58',
  moundFreshPellet: '#B89270',
};

export const strata = {
  topsoil: '#5E4232',
  loam: '#7A5A40',
  sandBand: '#B8936A',
  clay: '#A0664A',
  subsoil: '#6B4A38',
  deep: '#4A3428',
  rock: '#8A8078',
  pebbles: ['#9C8B7A', '#C2B29E'],
  roots: '#D8C3A0',
};

export const tunnels = {
  interior: '#2B1E17',
  rim: '#22170F',
  floorHighlight: '#6E4F38',
  wetSoilMultiply: '#5A4A48',
  /** Max alpha for the wet-soil multiply blend, from SPEC ("up to 35%"). */
  wetSoilMaxAlpha: 0.35,
};

/** Rain (SPEC section 6 "Rain") — kept muted and soft rather than saturated
 * "storm" blues, matching CLAUDE.md's "calm, gentle" bar. */
export const weather = {
  cloudCover: '#8A93A6',
  raindrop: '#CFE0EA',
  splash: '#E7F0F5',
  puddleWater: '#4A5A66',
  puddleRipple: '#CFE0EA',
  mushroomCap: '#C97B63',
  mushroomStem: '#EDE0C8',
};

/** Small surprises (SPEC section 6 "Small surprises") — kept muted and soft,
 * consistent with the rest of the palette rather than eye-catching. */
export const surprises = {
  earthworm: '#C98B6B',
  beetle: '#4A3A2A',
  beetleShell: '#6B5238',
  butterfly: '#E3A857',
  butterflyAccent: '#F3EAD6',
  snail: '#8A9A6A',
  snailShell: '#B8936A',
  leaf: '#B8863A',
  root: '#D8C3A0',
};

export const creatures = {
  workerBody: '#2E211C',
  workerHighlight: '#5A4036',
  /** A thin body outline, not the fill — the fill stays dark so ants still
   * read well against light grass (M11 contrast audit: the fill alone was
   * only ~1.04:1 against the tunnel interior, nearly invisible; this rim
   * gets that up to a clearly visible ~4.8:1 without changing how ants look
   * against the surface, where the dark fill already contrasts fine). */
  workerOutline: '#A9855F',
  queenBody: '#3A2620',
  queenAbdomenBand: '#7A4A2A',
  queenWings: '#EEF2F2',
  queenWingsAlpha: 0.6,
  egg: '#F6EFDD',
  larva: '#F0E4C6',
  pupa: '#E4CFA3',
  seed: '#D6A45C',
  crumb: '#E7C98F',
  fireflyGlow: '#F7E48A',
  stars: '#FDF6E3',
};

export const ui = {
  textOnSky: '#FFF8EC',
  textOnPanel: '#3B2A20',
  honeyAccent: '#E3A857',
  /** M11 contrast audit: `textOnSky` against this panel, blended over the
   * *lightest* sky keyframes (day/dawn horizon), only cleared WCAG AA's 4.5:1
   * normal-text minimum once alpha reached about 0.65 — 0.55 bottomed out
   * around 3.7:1 at the worst keyframe. Every text-on-sky element needs an
   * actual panel behind it for this to apply (see styles.css's `#mode-toggle`
   * and `#task-name`, which had none before). */
  panelBackground: 'rgba(59, 42, 32, 0.65)',
};

export interface SkyColors {
  skyTop: number;
  skyHorizon: number;
  lightTint: number;
  exposure: number;
}

const keyframesByClock = [timeOfDay.night, timeOfDay.dawn, timeOfDay.day, timeOfDay.dusk].map(
  (k) => k,
);

/**
 * Blends the four time-of-day keyframes for a given hour (0-24, cyclic), so
 * the sky and scene light change smoothly rather than snapping between
 * states (CLAUDE.md "Nothing flickers, jitters, or snaps").
 */
export function sampleTimeOfDay(hours: number): SkyColors {
  const h = ((hours % 24) + 24) % 24;

  // Keyframes sorted by clock, with night's 0 also placed at 24 so the last
  // segment (dusk -> night) interpolates correctly across midnight.
  const points = [...keyframesByClock, { ...timeOfDay.night, clock: 24 }];

  let a = points[0];
  let b = points[points.length - 1];
  for (let i = 0; i < points.length - 1; i++) {
    if (h >= points[i].clock && h <= points[i + 1].clock) {
      a = points[i];
      b = points[i + 1];
      break;
    }
  }

  const span = b.clock - a.clock;
  const t = span === 0 ? 0 : (h - a.clock) / span;

  return {
    skyTop: lerpColor(a.skyTop, b.skyTop, t),
    skyHorizon: lerpColor(a.skyHorizon, b.skyHorizon, t),
    lightTint: lerpColor(a.lightTint, b.lightTint, t),
    exposure: lerp(a.exposure, b.exposure, t),
  };
}

/** Depth dimming applied to soil regardless of time of day (SPEC section 7). */
export const soilDepthDimming = {
  /** Fraction darker at the deepest point of the world. */
  maxDarkenAtDepth: 0.25,
};

/** Global overlay treatment applied across the whole scene (SPEC section 7). */
export const globalTreatment = {
  paperGrainOpacity: 0.05,
  vignetteStrength: 0.12,
  /** SPEC section 6: "scene light" blends `lightTint` across everything at
   * or below the grass line (soil, surface, ants — the sky already gets its
   * own dedicated gradient). Kept low: this is a gentle color-mood shift,
   * not the main day/night darkening — that's `exposure`, applied
   * separately so the two can't compound into "too dark." */
  timeOfDayTintAlpha: 0.16,
};

/** Dev-mode-only debug colors (SPEC section 11 "planner chambers and jobs"
 * overlay) — never shown to a real user, so these skip the storybook
 * palette's restraint in favor of being easy to tell apart at a glance. */
export const devOverlay = {
  chamberOutlineByType: {
    royal: '#E85A5A',
    nursery: '#F3EAD6',
    granary: '#D6A45C',
    resting: '#7AC0E8',
  },
  connectorJob: '#7AE89A',
  shaftJob: '#F3C64A',
};
