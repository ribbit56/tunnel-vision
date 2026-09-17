// Tunable numbers for sim, pacing, and layout timings (CLAUDE.md "Style").
// Palette/color values live in src/theme/palette.ts instead.
//
// This file grows milestone by milestone; only the constants a milestone
// actually uses are added, rather than stubbing out later sections early.

export const layout = {
  /** Fraction of the window height given to sky before the grass line, in the
   * placeholder M0/M1 scene. Replaced by the real world-to-screen camera
   * mapping in M4. */
  skyFraction: 0.45,
};
