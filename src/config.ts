// Tunable numbers for sim, pacing, and layout timings (CLAUDE.md "Style").
// Palette/color values live in src/theme/palette.ts instead.
//
// This file grows milestone by milestone; only the constants a milestone
// actually uses are added, rather than stubbing out later sections early.

export const layout = {
  /** Fraction of the window height where the grass line sits — the auto-
   * framing camera (`render/camera.ts`) always keeps it here except while
   * the user is actively dragging vertically. */
  skyFraction: 0.42,
  /** Minimum vertical slice of world space (sky + soil) the auto-framing
   * camera keeps visible for a small/fresh nest, so it starts at a
   * deliberately chosen framing rather than zoomed in tight on a bare
   * entrance notch. Also the floor a tall/narrow (phone) viewport falls
   * back to once it's already showing this much depth. */
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

/** SPEC section 6: "fireflies drift over the grass at night (a handful,
 * slow glow pulses)." Visible only as night factor rises; see
 * `render/surface.ts`. */
export const fireflies = {
  count: 6,
  /** World px either side of a firefly's resting spot it gently loops
   * around — small and slow enough to read as "drifting," not flying. */
  driftRadius: 26,
  driftSpeed: 0.12, // Hz
  pulseSpeed: 0.2, // Hz, slower and gentler than the stars' own twinkle
  glowRadius: 3,
};

/** An ant's digging motion (SPEC section 5 "Digging"): the colony planner
 * (`sim/colony/planner.ts`, M4) decides *where* a shaft, chamber, or
 * connector job goes; everything here is purely about *how* an ant carves
 * once it's working one. A shaft job digs with the full correlated random
 * walk below (wander, lean, hardness deflection) — the same organic motion
 * from earlier milestones, just aimed by the job's own heading instead of a
 * per-ant lean picked at creation. Chamber and connector jobs use a simpler
 * seek-and-carve motion instead (see `ants/digger.ts`'s `seekAndDig`),
 * since they're filling in a shape the planner already chose rather than
 * exploring. */
export const digging = {
  wanderRate: 0.4, // rad/s scale of the preferred heading's slow drift
  leanPullStrength: 0.5, // how strongly the preferred heading is pulled back to the lean
  headingNoise: 0.6, // rad/s scale of fast, fine heading jitter (texture only)
  steeringStrength: 1.2, // how strongly the actual heading chases the preferred one
  hardnessDeflection: 2.2, // turn away from the harder side of the dig face
  hardnessSlowdown: 0.7, // fraction of speed lost digging at max hardness
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
   * back and forth instead of digging. */
  carryVolumeThreshold: 60,
  edgeMarginCells: 12, // SPEC section 3 invariant
  /** Radians turned, in a random direction, when a step would land in rock
   * or the edge margin. The soft hardness deflection above is only a nudge
   * and can lose to the pull back toward the lean angle against a rock
   * formation wider than one nudge can route around; this is the hard
   * backstop that actually refuses the step. */
  blockedTurnKick: 1.2,
  chamberRadiusXCells: 6, // flattened, wider-than-tall (SPEC's chamber shape)
  chamberRadiusYCells: 3.2,
  chamberSpeedFactor: 0.2, // crawl while carving so the brush overlaps into a bubble
};

/** Steering shared by every ant, regardless of role (SPEC section 5
 * "Movement and pathing"). Digging-specific numbers stay in `digging` above;
 * these apply equally to a digger walking a path and a wanderer strolling
 * the tunnels. */
export const movement = {
  /** SPEC: "worker 18 to 26 (each ant gets its own)" — picked once per ant
   * at creation so the crowd doesn't move in lockstep. */
  speedMin: 18,
  speedMax: 26,
  /** rad/s. SPEC: "turning rate is capped. No instant turns." */
  maxTurnRate: 3.2,
  /** Start slowing down within this many world px of a path's final point,
   * easing into "arrive" instead of walking at full speed until it snaps to
   * a stop (steering.ts's `arriveSpeedFactor`). */
  arriveRadius: 14,
  /** How close counts as "reached" for an intermediate path waypoint (not
   * the final one, which uses `arriveRadius` instead) before advancing to
   * the next — needs to be a little forgiving so the ant doesn't overshoot
   * and turn back on itself at a shallow-angle corner. */
  waypointRadius: 6,
  /** SPEC: "light separation so ants don't overlap." Distance at which two
   * ants start gently pushing apart, and how much of that push is applied
   * per tick (a soft nudge, not an instant shove). */
  separationRadius: 10,
  separationStrength: 0.6,
  /** SPEC: "ants hug tunnel floors and walls slightly rather than floating
   * in the middle." Implemented as a small persistent sideways offset from
   * a path's own centerline, picked once per ant, rather than continuously
   * sensing walls every tick — cheap, stable, and never jitters. */
  hugOffsetMax: 4, // world px
  /** SPEC section 6: "colony activity at night is reduced (movement speed ×
   * 0.8...)" — blended smoothly by night factor, not a hard switch. */
  nightSpeedFactor: 0.8,
};

/** How many ants exist (SPEC section 5, MILESTONES M3 "20 ants wandering and
 * digging together"). Every ant is a generalist: idle ones ask the colony
 * planner for a job and dig it if one's available, or wander the open
 * tunnels if not (see `ants/digger.ts`). Real role assignment (diggers,
 * nurses, foragers, idlers) arrives in M5. */
export const ants = {
  count: 20,
  /** How far from its current position a wanderer picks its next stroll
   * target — keeps A* searches small and wandering visually local rather
   * than ants constantly crossing the whole nest. */
  wanderRadiusMin: 60,
  wanderRadiusMax: 160,
  wanderPauseMinSeconds: 1,
  wanderPauseMaxSeconds: 4,
};

/** The colony planner (SPEC section 4, `sim/colony/planner.ts`): decides
 * where shafts extend, when and where chambers belong, when two chambers get
 * connected, and — via `pickNextChamberType` — which type of chamber the
 * colony's current needs (brood, food, idle workers) call for next. */
export const planner = {
  /** How often the planner re-evaluates the colony's needs and tops up the
   * job queue. Colony growth is inherently slow ("calm over busy"), so this
   * doesn't need tick-level freshness. */
  evaluationIntervalTicks: 90,

  // Pacing curve (SPEC section 2), exact values from spec.
  foundingCells: 30,
  cellsPerWorker: 90,
  foundingMinutes: 6,
  curveSoftnessMinutes: 30,
  matureMinutes: 120,
  matureWorkers: 50,
  capWorkers: 70,

  /** World px a shaft job digs before the ant reports back and the planner
   * re-evaluates (SPEC's `ShaftSegment.length`) — long enough that a shaft
   * doesn't ping back to the planner every few seconds, short enough that
   * fresh stretches of shaft become available for chamber placement often. */
  shaftSegmentLengthMin: 150,
  shaftSegmentLengthMax: 350,
  /** Radians either side of straight down for the founding shaft's lean
   * (SPEC: "gentle lean"), and for how far a secondary shaft's own initial
   * heading can wander off vertical. */
  initialShaftLeanRange: 0.5,
  secondaryShaftLeanRange: 1.6,
  /** Radians either side of a shaft's own recent heading (see
   * `shaftRecentHeading`) each further continuation is allowed to wander —
   * a shaft that's already drifted off vertical keeps drifting rather than
   * re-centering, which over several segments is what actually spreads the
   * network out horizontally instead of everything hugging a narrow column
   * around the entrance (M11 polish pass, per owner feedback that nests
   * read as too clustered). */
  shaftContinueDeflectionRange: 0.5,
  /** Capped total (SPEC: "secondary shafts... descend on their own", kept to
   * a handful so the nest still reads as organized around a few trunks). */
  maxMajorShafts: 4,
  majorShaftChance: 0.3,

  /** How far apart (world px) a point is recorded along a shaft's permanent
   * centerline as it's dug — this is what chamber placement samples
   * candidate sites from. */
  shaftPointSampleDistance: 3,
  // SPEC: "minimum spacing from other chambers (at least 8 cells vertical, 6
  // horizontal clearance)" — cell counts converted to world px here since
  // that's what placement scoring works in.
  chamberSpacingVertical: 8 * 4,
  chamberSpacingHorizontal: 6 * 4,
  /** Extra world px beyond a chamber's own radius that its connector spans,
   * so the chamber sits clear of the shaft it buds off rather than
   * overlapping it. */
  chamberSideOffsetSlack: 10,
  /** Scale of the small random nudge added to each candidate site's score,
   * so ties (and near-ties) break differently per seed (SPEC). */
  candidateJitter: 0.15,
  /** Chance, per evaluation while behind on growth, of even attempting a
   * chamber rather than growing/branching a shaft outright — keeps chambers
   * from saturating a short stretch of shaft before it's had room to
   * lengthen, which reads as an unnaturally regular ladder rather than
   * chambers scattered organically along a growing shaft. */
  chamberAttemptChance: 0.35,

  // SPEC: "a new chamber is requested when a need crosses a threshold" —
  // how much of each resource one chamber of that type can hold before
  // another is requested. Kept as capacity-per-chamber, not a flat count, so
  // a bigger colony naturally ends up with more of whichever type it needs
  // most, instead of every colony cycling the same fixed rotation of types
  // in the same order (see `pickNextChamberType`).
  broodCapacityPerNurseryChamber: 6,
  /** Granary need is measured against food already stored, which only ever
   * grows over a session (SPEC: "sparser and smaller deeper" — granary
   * chambers should stay the rarest type), so this needs to be well above
   * the other two capacities to keep granary count from climbing as fast as
   * nursery/resting do over a long run. */
  foodCapacityPerGranaryChamber: 30,
  idleCapacityPerRestingChamber: 12,

  // SPEC: "chambers are 18 to 40 cells wide and 6 to 10 cells tall," split
  // across types by where SPEC says each one tends to sit and how large it
  // reads relative to the others (radii = half width/height, in world px).
  chamberRadiusXByType: {
    royal: [36, 48] as [number, number],
    nursery: [40, 60] as [number, number],
    granary: [50, 80] as [number, number],
    resting: [36, 50] as [number, number],
  },
  chamberRadiusYByType: {
    royal: [12, 14] as [number, number],
    nursery: [12, 16] as [number, number],
    granary: [14, 20] as [number, number],
    resting: [12, 16] as [number, number],
  },
  /** World px between stops as an ant sweeps a chamber's footprint — small
   * enough that consecutive brush applications overlap and fully open it. */
  chamberBrushSpacing: 10,

  /** SPEC: "occasional short connecting tunnels between nearby chambers...
   * keep them rare." Chance per planner evaluation of considering one, and
   * how close two chambers (on different shafts) need to be to qualify. */
  connectorChancePerEvaluation: 0.06,
  connectorMaxDistance: 200,
};

/** The queen's founding sequence (SPEC section 2 "Founding timeline"): the
 * one-time intro before the colony has any workers. All timings are focused
 * minutes, not real time — like every other growth system, the founding
 * sequence only advances while the timer is running. After she settles, the
 * founding shaft and royal chamber are dug the exact same way any other
 * shaft/chamber job is (SPEC: "planner decides what, ants decide how") —
 * she's just the only ant alive yet to do it. */
export const queen = {
  glideSeconds: 15, // SPEC: "gentle, slightly wandering glide (about 15s)"
  walkAfterLandSeconds: 15, // 0:15 to 0:30: lands, walks a little, sheds wings
  speed: 10, // SPEC section 5 "Movement and pathing": "queen 10"
  bodyLength: 15, // SPEC section 3: "queen about 15px"
  /** How far above the entrance she starts, and how far she wanders
   * sideways while gliding down — cosmetic, just needs to read as a gentle
   * drift rather than a straight drop. */
  glideStartHeight: 260,
  glideWander: 40,
};

/** Brood maturation and egg-laying (SPEC section 2 founding timeline: eggs
 * at 3:00, larvae at 5:00, pupae at 7:00, first workers at 8:30 — giving
 * ~2 minutes per stage, reused for every clutch after the first). */
export const lifecycle = {
  eggStageMinutes: 2,
  larvaStageMinutes: 2,
  pupaStageMinutes: 1.5,
  /** How often to check whether a new egg is needed (SPEC: "egg laying rate
   * is driven by the gap between targetWorkers and (workers + brood)") —
   * checking every few seconds rather than continuously keeps this from
   * needing its own fine-grained rate curve. */
  eggCheckIntervalMinutes: 0.5,
  /** SPEC: "first small workers (nanitics, 80% size)" — how many of the
   * very first workers are undersized nanitics before regular-size workers
   * start emerging. */
  naniticCount: 3,
  naniticSizeScale: 0.8,
};

/** Role mix (SPEC section 5 "Roles"): recomputed periodically from colony
 * needs rather than fixed at creation, so the crowd shifts gradually as the
 * nest grows a nursery, a granary, and more brood/food to tend. */
export const roles = {
  rebalanceIntervalMinutes: 0.25,
  /** SPEC: "a minority of workers (about 30%) does most of the digging
   * while many others idle." */
  diggerFraction: 0.3,
  /** Nurses and foragers are capped small counts, not fractions — a couple
   * of hands is plenty for carrying brood or food one at a time; the rest
   * of the non-digging majority idles (SPEC: "that loitering reads as
   * peaceful, keep it"). */
  maxNurses: 2,
  maxForagers: 2,
  /** SPEC section 6: "...fewer foragers, more resting" at night — scales
   * `maxForagers` and `diggerFraction` down at full night, blended smoothly
   * by night factor like everything else in the day/night system. Nurses
   * are left alone: brood care doesn't pause for the night. */
  nightForagerFactor: 0.5,
  nightDiggerFactor: 0.7,
};

/** Surface food for foragers to find (SPEC: "foragers... pick up seeds and
 * crumbs, bring them to the granary"). Spawns are simple and low-frequency —
 * SPEC's richer weather-linked foraging behavior (foragers heading home from
 * rain, etc.) arrives with rain in M8. */
export const foraging = {
  spawnIntervalMinutesMin: 0.5,
  spawnIntervalMinutesMax: 1.5,
  maxUnclaimedFood: 4,
  /** World px either side of the entrance that food can spawn within —
   * keeps foragers' surface walks short and visible near the mound. */
  spawnRangeX: 220,
};

/** Purely cosmetic leg-animation constants (CLAUDE.md: renderer-only
 * randomness/timing lives beside the sim tunables it doesn't affect). SPEC:
 * "a simple tripod gait animation whose cycle rate matches speed." */
export const antRender = {
  /** World px of travel per full gait cycle — speed divided by this gives
   * the cycle rate, so faster ants visibly take faster steps. */
  strideLength: 14,
  /** How far a foot swings forward/back from its resting position, as a
   * fraction of body length. */
  strideAmplitude: 0.16,
  /** How far a leg shortens toward the body at the top of its swing, so it
   * visibly lifts rather than sliding flat along the ground. */
  liftAmplitude: 0.3,
};

/** Pomodoro mode's round lengths (SPEC section 8: "focus and break lengths,
 * default 25 and 5, with a long break of 15 every 4 rounds"). */
export const pomodoro = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

/** How long the UI waits without mouse/keyboard activity before fading (SPEC
 * section 8: "fades out after 4 seconds... fades back in on any input"). */
export const idleFade = {
  idleSeconds: 4,
  fadeSeconds: 1.5,
};

/** Catch-up mode after a hidden tab (SPEC section 8 "Returning to a hidden
 * tab"). */
export const catchUp = {
  msBudgetPerFrame: 8,
  capMinutes: 180,
};

/** Day/night cycle (SPEC section 6). Compressed mode is the default; real
 * time is a settings-panel opt-in. */
export const dayNight = {
  compressedCycleMinutes: 24,
  /** SPEC: "sessions start at mid-morning." */
  sessionStartHour: 9,
};

/** Weather (SPEC section 6 "Rain"). Timings feed `environment/weather.ts`'s
 * seeded schedule; the rest tune the moisture front and the rain visuals. */
export const weather = {
  firstRainMinMinutes: 15,
  meanGapMinutes: 45,
  cloudingSecondsMin: 60,
  cloudingSecondsMax: 90,
  rainMinutesMin: 4,
  rainMinutesMax: 8,
  clearingSecondsMin: 80,
  clearingSecondsMax: 100,

  /** How many rows deep (from the surface) the moisture front is tracked at
   * all — rain events are short enough that it never needs to reach deep
   * soil, so cells below this just stay dry and skip the update entirely. */
  moistureMaxDepthCells: 50,
  /** Per-second rate a row's moisture rises toward the current rain
   * intensity while it's raining. */
  moistureRiseRatePerSecond: 0.06,
  /** Per-second decay applied to every tracked row regardless of rain —
   * tuned so a fully soaked profile mostly dries out over about 10 minutes
   * (SPEC), the same "drying" curve the render layer's soil-darkening
   * overlay independently follows (see `render/weather.ts`). */
  moistureDryRatePerSecond: 0.005,
  /** How much of a wetter row's moisture reaches the row below it each
   * second — small, so the front visibly takes time to descend rather than
   * soaking the whole tracked depth at once. */
  moistureFrontRatePerSecond: 0.5,

  /** SPEC section 10 budget: "max 400 raindrops." */
  maxRaindrops: 400,
  raindropFallSpeedMin: 260,
  raindropFallSpeedMax: 340,
  raindropLength: 14,
  maxSplashes: 40,
  splashFadeSeconds: 0.35,

  /** A handful of fixed surface dips that fill with water while it rains and
   * drain slowly afterward. */
  puddleCount: 4,
  puddleFillRatePerSecond: 0.2,
  puddleDrainRatePerSecond: 0.03,
  maxRipples: 8,
  rippleIntervalSeconds: 1.1,
  rippleLifetimeSeconds: 1.6,

  /** SPEC: "a few small mushrooms may sprout... and fade over 10 to 15
   * minutes" — rolled once per rain event as it clears, independently of the
   * sim (cosmetic-only, CLAUDE.md "separate render RNG"). */
  mushroomChance: 0.5,
  mushroomCountMin: 1,
  mushroomCountMax: 3,
  mushroomFadeMinutesMin: 10,
  mushroomFadeMinutesMax: 15,

  /** Ceiling for the full-scene grey cloud-cover tint (render/weather.ts) —
   * the wet-soil darkening's own ceiling is `palette.ts`'s `wetSoilMaxAlpha`,
   * alongside the color it tints with. Kept modest so overcast still reads
   * as gentle, not stormy. */
  cloudCoverAlphaMax: 0.4,
};

/** Small surprises (SPEC section 6): occasional cosmetic creatures/moments,
 * scheduled by `environment/surprises.ts`. Root growth is excluded — it's
 * SPEC's one "Continuous" entry, driven directly by session time instead of
 * this rotation (see `render/surprises.ts`). */
export const surprises = {
  gapMinutesMin: 6,
  gapMinutesMax: 12,

  // SPEC: "beetle... trundles across, pauses, leaves" etc. — how long one
  // occurrence plays out, per kind.
  durationSecondsByKind: {
    earthworm: [40, 70] as [number, number],
    beetle: [12, 20] as [number, number],
    butterfly: [15, 25] as [number, number],
    snail: [35, 55] as [number, number],
    fallingLeaf: [20, 30] as [number, number],
    extraFireflies: [90, 150] as [number, number],
  },

  // Relative likelihood before the day/night and weather modifiers in
  // `pickKind` — snail set a little below the others since it's the
  // slowest, least frequent-feeling of the surface creatures.
  baseWeight: {
    earthworm: 1,
    beetle: 1,
    butterfly: 1,
    snail: 0.6,
    fallingLeaf: 1,
    extraFireflies: 1,
  },
  afterRainWeightBoost: 2.5,

  earthwormSpeed: 7, // world px/s — slow, "passes through the soil"
  earthwormLength: 24,
  beetleSpeed: 15,
  snailSpeed: 3,
  butterflySpeed: 22,
  butterflyBobAmplitude: 16,
  butterflyBobSpeed: 0.6, // Hz
  fallingLeafFallSpeed: 9,
  fallingLeafSwaySpeed: 0.5, // Hz
  fallingLeafSwayAmplitude: 14,
  fallingLeafRestSeconds: 15,
  fallingLeafFadeSeconds: 8,
  extraFirefliesCount: 5,

  // Root growth (SPEC: "continuous... lengthens almost imperceptibly") — a
  // slow, saturating curve driven by total elapsed real session time, not
  // by the surprise rotation above.
  rootCount: 2,
  rootMaxLength: 55,
  /** Real minutes for a root to grow most of the way to `rootMaxLength` —
   * "almost imperceptible" moment to moment, but a visibly longer root over
   * the course of a long session. */
  rootGrowthSaturationMinutes: 90,
};

export const surfaceFeatures = {
  /** World x of the entrance; matches the entrance column dug in sim/world.ts. */
  entranceX: 800,
  entranceRadius: 14,
  /** Keeps grass/flowers from growing where the mound will grow into. */
  entranceKeepout: 90,
};
