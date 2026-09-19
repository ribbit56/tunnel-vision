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

/** A single digger's correlated random walk (SPEC section 5 "Digging"). No
 * planner exists yet (M4), so there's no real dig job to steer toward —
 * instead the digger follows its own slowly wandering "preferred heading",
 * pulled back toward a persistent gentle per-seed lean off straight down. */
export const digging = {
  wanderRate: 0.4, // rad/s scale of the preferred heading's slow drift
  leanPullStrength: 0.5, // how strongly the preferred heading is pulled back to the lean
  leanRange: 0.5, // radians either side of straight down for the per-seed lean
  headingNoise: 0.6, // rad/s scale of fast, fine heading jitter (texture only)
  steeringStrength: 1.2, // how strongly the actual heading chases the preferred one
  hardnessDeflection: 2.2, // turn away from the harder side of the dig face
  hardnessSlowdown: 0.7, // fraction of speed lost digging at max hardness
  baseSpeed: 22, // world px/s
  carrySpeedFactor: 0.8, // SPEC section 5 "carrying 80% of normal"
  /** SPEC section 3: "tunnels are 4 to 5 cells wide" — that's a diameter, so
   * radius ~2 to 2.5. A too-small radius here was the real cause of the ant
   * visually overflowing the tunnel: its body plus legs and antennae span
   * close to the worker length (~9 world px) in every direction, wider than
   * a radius-1.5 (12px-diameter) brush ever opened. */
  brushRadiusCells: 2.25,
  /** Cell-units of soil dug before the ant carries a pellet trip to the
   * surface. One real pellet represents ~3 cells (SPEC); this is bundled
   * much larger for pacing, since a round trip's travel time grows with
   * depth — too low and nearly all of a session's time goes to commuting
   * back and forth instead of digging (and branching/carving chambers). */
  carryVolumeThreshold: 60,
  edgeMarginCells: 12, // SPEC section 3 invariant
  /** Radians turned, in a random direction, when a step would land in rock
   * or the edge margin. The soft hardness deflection above is only a nudge
   * and can lose to the pull back toward the lean angle against a rock
   * formation wider than one nudge can route around; this is the hard
   * backstop that actually refuses the step. */
  blockedTurnKick: 1.2,

  // Branching and chambers stand in for the real colony planner (M4): one
  // ant with no planner would otherwise just dig a single mostly-straight
  // shaft, which doesn't read as a nest (docs/reference/'s nest casts and
  // cross-section show many forking tunnels and rounded chambers).
  branchChance: 0.12, // probability per second of forking off a new branch
  branchMinBreadcrumbs: 90, // don't branch until there's a real trail to fork from
  branchBacktrackMinSteps: 20, // ticks' worth of trail to back up before forking
  branchBacktrackMaxSteps: 300,
  branchAngleMin: 0.7, // radians off the old heading a new branch aims (~40°)
  branchAngleMax: 1.9, // up to ~109°, so branches read as distinct forks
  /** Almost every fork is a short side branch that digs a bounded distance
   * and then returns to resume the shaft it came from — SPEC's "one main
   * shaft... with chambers budding off the sides", not a network of equally
   * important tunnels. Only rarely does a fork become a new shaft in its own
   * right (SPEC: "secondary shafts branch off... and descend on their
   * own"), capped at a handful total so the nest still reads as organized
   * around a few trunks rather than sprawling into unrelated fragments. */
  maxMajorShafts: 3,
  majorShaftChance: 0.12,
  sideBranchVolumeMin: 10, // cell-units a side branch digs before turning back
  sideBranchVolumeMax: 35,
  chamberChance: 0.08, // probability per second of pausing to open a chamber
  chamberDurationTicks: 130, // long enough to fully erode the brush's edges, not just its center
  chamberRadiusXCells: 6, // flattened, wider-than-tall (SPEC's chamber shape)
  chamberRadiusYCells: 3.2,
  chamberSpeedFactor: 0.2, // crawl while carving so the brush overlaps into a bubble
};

export const surfaceFeatures = {
  /** World x of the entrance; matches the entrance column dug in sim/world.ts. */
  entranceX: 800,
  entranceRadius: 14,
  /** Keeps grass/flowers from growing where the mound will grow into. */
  entranceKeepout: 90,
};
