// Tunable numbers for sim, pacing, and layout timings (CLAUDE.md "Style").
// Palette/color values live in src/theme/palette.ts instead.
//
// This file grows milestone by milestone; only the constants a milestone
// actually uses are added, rather than stubbing out later sections early.

export const layout = {
  /** Fraction of the window height where the grass line sits, in the fixed
   * M1 framing. Replaced by the real world-to-screen spring camera in M4. */
  skyFraction: 0.42,
  /** World x the fixed M1 camera centers on horizontally (the entrance). */
  cameraCenterX: 800,
  /** Minimum vertical slice of world space (sky + soil) the fixed M1 camera
   * keeps visible, so a tall/narrow (phone) viewport zooms in and crops left
   * and right instead of leaving empty space above and below the scene. */
  minVisibleWorldHeight: 1300,
};

/** World coordinates (SPEC section 3): y = 0 is the grass line, negative y is
 * sky, positive y is soil. All in "world pixels". */
export const world = {
  gridW: 400,
  gridH: 300,
  cellSize: 4,
  skyHeightAboveSurface: 520,
};

export const sky = {
  starCount: 90,
  /** Stars twinkle with a slow per-star phase offset, not a flicker. */
  twinkleSpeed: 0.15,
  twinkleDepth: 0.35,
  cloudCount: 3,
  cloudDriftSpeed: 1.2, // world px/s
};

export const grass = {
  tuftCount: 46,
  swaySpeed: 0.5, // Hz, base rate before per-tuft phase/amplitude variation
  swayAmplitude: 3.5, // degrees
  flowerCount: 7,
};

export const surfaceFeatures = {
  /** World x of the entrance, matching the hand-authored mask in tunnelMask.ts. */
  entranceX: 800,
  entranceRadius: 14,
  moundWidth: 150,
  moundHeight: 34,
};
