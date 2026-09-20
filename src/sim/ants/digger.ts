// Ants (SPEC section 5). Every worker is a generalist that gets *assigned* a
// role (digger, nurse, forager, idler) periodically by the colony's own
// needs (`sim/colony/lifecycle.ts`'s `rebalanceRoles`), rather than being
// born into one — SPEC: "role mix is recomputed every few seconds." The
// queen is a fifth, one-of-a-kind role: she runs a short founding sequence
// (glide down, land, shed wings) and then digs the very first shaft and
// chamber herself, before any workers exist, using the exact same digging
// code a digger role uses later — "planner decides what, ants decide how"
// applies to her too.
//
// Every travel phase — walking to a job site, carrying something home,
// resuming afterward, or just wandering — moves the same way underground: A*
// over open cells (`ants/pathing.ts`), smoothed by string-pulling, nudged
// slightly off-center to hug a wall or floor, and walked with rate-limited
// turning and an easing "arrive" at the far end (`ants/steering.ts`). A
// forager's walk along the surface is simpler — a straight line, since
// there's nothing to path around up there.
import type { Foraging } from '../colony/foraging';
import type { Lifecycle } from '../colony/lifecycle';
import type { ChamberType, DigJob, Planner, PlannerConfig } from '../colony/planner';
import { chamberSweepPoints, claimJob, recordShaftPoint } from '../colony/planner';
import type { Rng } from '../rng';
import { createStream } from '../rng';
import type { Mound } from '../surface/mound';
import { depositPellet } from '../surface/mound';
import type { DirtyRect, World } from '../world';
import { digBrush, entrancePosition, isDiggable, sampleHardness } from '../world';
import { findPath, hasLineOfSight, isOpenCell, stringPull } from './pathing';
import { angleDiff, arriveSpeedFactor, turnToward, type Point } from './steering';

export type AntRole = 'queen' | 'digger' | 'nurse' | 'forager' | 'idler';

export type AntPhase =
  // queen-only founding sequence
  | 'queenGliding'
  | 'queenWalking'
  | 'queenSettled'
  // digging (queen, while founding; digger role, ongoing)
  | 'idle'
  | 'movingToJobSite'
  | 'diggingShaft'
  | 'diggingChamber'
  | 'diggingConnector'
  | 'movingToSurface'
  | 'returningToResume'
  // nurse
  | 'nurseFetching'
  | 'nurseCarrying'
  // forager
  | 'foragerToEntrance'
  | 'foragerToFood'
  | 'foragerReturning'
  | 'foragerToGranary'
  // rain (SPEC section 6): a one-off job assigned directly by sim.ts, not a
  // role of its own — see `Simulation.entrancePlugged`.
  | 'plugEntrance'
  | 'unplugEntrance'
  // idler / fallback when there's nothing else to do
  | 'movingToTarget'
  | 'pausing'
  // any role, while focus is paused (SPEC section 2)
  | 'resting';

/** What a small carried-item dot near the ant should show, if anything —
 * mutually exclusive, since an ant only ever carries one thing at a time. */
export type CarriedItem = 'pellet' | 'egg' | 'larva' | 'pupa' | 'seed' | 'crumb' | null;

export interface Ant {
  x: number;
  y: number;
  heading: number;
  /** Slowly wanders on its own; `heading` chases it. Keeps paths smooth and
   * continuous instead of snapping toward a point. */
  preferredHeading: number;
  /** This ant's persistent gentle lean off straight down for whichever
   * shaft job it's currently working (SPEC: "main shaft... with gentle
   * lean"). Reset to a job's own heading each time one starts. */
  leanAngle: number;
  role: AntRole;
  phase: AntPhase;
  /** SPEC: "worker 18 to 26 (each ant gets its own)," fixed for the ant's
   * lifetime. Ignored by the queen, who always moves at her own fixed speed
   * (still stored here, just not randomized). Never read directly by
   * movement code — see `baseSpeed`. */
  baseSpeedUnscaled: number;
  /** `baseSpeedUnscaled` scaled by the current night factor (SPEC section 6:
   * "movement speed × 0.8" at night) — recomputed once per tick at the top
   * of `stepAnt`, before any phase handler runs, so every one of the many
   * `ant.baseSpeed`-reading call sites picks up the night slowdown for free
   * without each needing its own copy of that math. */
  baseSpeed: number;
  /** This tick's actual world-px/s of movement — 0 while paused, blocked, or
   * between jobs. Render-only leg-gait animation reads this (SPEC: "cycle
   * rate matches speed") instead of inferring it from interpolated
   * positions, so it stays correct at any dev time scale. */
  currentSpeed: number;
  /** 1 normally; SPEC's nanitic workers (the first few, before the colony
   * has full-size labor to spare) render at `naniticSizeScale` instead. */
  sizeScale: number;

  // --- current dig job (queen or digger role) ---
  currentJob: DigJob | null;
  carriedVolume: number;
  diggingProgress: number;
  /** Shaft jobs only: world px of the segment's length budget left to dig. */
  shaftRemainingLength: number;
  /** Chamber jobs only: the planned visiting order across its footprint
   * (SPEC: "excavated from the connector side outward") and progress
   * through it. */
  chamberSweep: Point[] | null;
  chamberSweepIndex: number;
  /** Connector jobs only: where this connector is digging toward. */
  connectorTargetX: number;
  connectorTargetY: number;
  /** Captured the moment a surface trip starts: where and how the current
   * job's digging was left, so it can pick up exactly where it left off. */
  jobResumeX: number;
  jobResumeY: number;
  jobResumeHeading: number;
  jobResumePreferredHeading: number;
  jobResumeLeanAngle: number;

  // --- what's being carried, and by whom (nurse/forager roles) ---
  carryingItem: CarriedItem;
  carriedBroodId: number | null;
  claimedFoodId: number | null;

  // --- queen-only founding sequence ---
  /** Seconds into the current queen phase — only advances while focus is
   * running, so a pause mid-glide just holds her in place. */
  queenPhaseTimer: number;
  /** 1 at first, fades to 0 during the walk phase (SPEC: "wings flutter to
   * the ground and fade"). */
  wingsAlpha: number;
  /** A small fixed sideways offset from the entrance she lands at, walked
   * off during `queenWalking` — picked once so "walks a little" reads as an
   * actual short walk rather than standing still. */
  queenLandOffsetX: number;

  // --- shared travel state ---
  pathTargetX: number;
  pathTargetY: number;
  /** Cached smoothed path to `pathTargetX/Y`. A path never becomes invalid
   * once found — digging only ever opens cells, never closes them — so
   * it's only recomputed when the target itself changes, not on a timer. */
  path: Point[] | null;
  pathIndex: number;
  /** A persistent small sideways offset from a path's own centerline,
   * picked once per ant, so it walks a little to one side of a tunnel
   * rather than dead center (SPEC: "hug tunnel floors and walls slightly
   * rather than floating in the middle"). */
  hugOffset: number;

  // --- wandering (idler role, or a digger/queen with nothing to do) ---
  wanderPauseRemaining: number;

  rng: Rng;
}

export interface DiggingConfig {
  wanderRate: number;
  leanPullStrength: number;
  headingNoise: number;
  steeringStrength: number;
  hardnessDeflection: number;
  hardnessSlowdown: number;
  carrySpeedFactor: number;
  brushRadiusCells: number;
  carryVolumeThreshold: number;
  edgeMarginCells: number;
  blockedTurnKick: number;
  chamberRadiusXCells: number;
  chamberRadiusYCells: number;
  chamberSpeedFactor: number;
}

export interface MovementConfig {
  speedMin: number;
  speedMax: number;
  maxTurnRate: number;
  arriveRadius: number;
  waypointRadius: number;
  separationRadius: number;
  separationStrength: number;
  hugOffsetMax: number;
  nightSpeedFactor: number;
}

export interface WanderConfig {
  wanderRadiusMin: number;
  wanderRadiusMax: number;
  wanderPauseMinSeconds: number;
  wanderPauseMaxSeconds: number;
}

export interface QueenConfig {
  glideSeconds: number;
  walkAfterLandSeconds: number;
  speed: number;
  glideStartHeight: number;
  glideWander: number;
}

/** Everything a tick needs to read or mutate beyond the ant itself. Bundled
 * since nearly every phase touches several of these — a flat parameter list
 * this long was harder to read than a couple of named groups. */
export interface AntStepContext {
  world: World;
  mound: Mound;
  planner: Planner;
  lifecycle: Lifecycle;
  foraging: Foraging;
  /** CLAUDE.md "Two clocks": colony growth (claiming new work, digging
   * progress, egg-laying) only happens while this is true. Movement already
   * in progress is allowed to finish rather than snapping to a stop — see
   * `stepAnt`'s own resting check. */
  focusRunning: boolean;
  /** SPEC section 6: 0 full day, 1 full night — drives the night-time
   * movement slowdown (see `Ant.baseSpeed`). Environment state, so it's a
   * `realTime` concern (CLAUDE.md "Two clocks"): it keeps moving even while
   * focus is paused, the same way day and night don't stop for a break. */
  nightFactor: number;
  /** SPEC section 6 "Small surprises": the x position of an active
   * surface-level surprise worth reacting to (currently just a passing
   * beetle — SPEC's own example), or null when there's nothing to react to.
   * Another `realTime` value, set externally each frame like `nightFactor`. */
  surfaceSurpriseX: number | null;
}

export interface AntStepConfig {
  digging: DiggingConfig;
  movement: MovementConfig;
  wander: WanderConfig;
  planner: PlannerConfig;
  queen: QueenConfig;
}

function createBaseAnt(rng: Rng, x: number, y: number, heading: number, role: AntRole, baseSpeed: number, movementCfg: MovementConfig): Ant {
  const hugOffset = (rng() - 0.5) * 2 * movementCfg.hugOffsetMax;
  return {
    x,
    y,
    heading,
    preferredHeading: heading,
    leanAngle: heading,
    role,
    phase: 'idle',
    baseSpeedUnscaled: baseSpeed,
    baseSpeed,
    currentSpeed: 0,
    sizeScale: 1,
    currentJob: null,
    carriedVolume: 0,
    diggingProgress: 0,
    shaftRemainingLength: 0,
    chamberSweep: null,
    chamberSweepIndex: 0,
    connectorTargetX: x,
    connectorTargetY: y,
    jobResumeX: x,
    jobResumeY: y,
    jobResumeHeading: heading,
    jobResumePreferredHeading: heading,
    jobResumeLeanAngle: heading,
    carryingItem: null,
    carriedBroodId: null,
    claimedFoodId: null,
    queenPhaseTimer: 0,
    wingsAlpha: 0,
    queenLandOffsetX: 0,
    pathTargetX: x,
    pathTargetY: y,
    path: null,
    pathIndex: 0,
    hugOffset,
    wanderPauseRemaining: 0,
    rng,
  };
}

export function createWorkerAnt(seed: string, index: number, x: number, y: number, nanitic: boolean, lifecycleCfg: { naniticSizeScale: number }, movementCfg: MovementConfig): Ant {
  const rng = createStream(seed, `ants:${index}`);
  const baseSpeed = movementCfg.speedMin + rng() * (movementCfg.speedMax - movementCfg.speedMin);
  const heading = rng() * Math.PI * 2;
  const ant = createBaseAnt(rng, x, y, heading, 'idler', baseSpeed, movementCfg);
  ant.sizeScale = nanitic ? lifecycleCfg.naniticSizeScale : 1;
  return ant;
}

export function createQueen(seed: string, world: World, queenCfg: QueenConfig, movementCfg: MovementConfig): Ant {
  const rng = createStream(seed, 'ants:queen');
  const entrance = entrancePosition(world);
  const ant = createBaseAnt(rng, entrance.x, -queenCfg.glideStartHeight, Math.PI / 2, 'queen', queenCfg.speed, movementCfg);
  ant.phase = 'queenGliding';
  ant.wingsAlpha = 1;
  ant.queenLandOffsetX = (rng() - 0.5) * 2 * 12;
  return ant;
}

export interface DiggerStepResult {
  dirty: DirtyRect | null;
  /** Set only by `stepPlugEntrance`/`stepUnplugEntrance` the tick they
   * finish — `sim.ts` applies it to `Simulation.entrancePlugged`, since the
   * ant itself just returns to idle right after and has no further memory
   * of having done it. */
  entrancePlugChange?: 'plugged' | 'unplugged';
}

/** Hardness for steering purposes: solid rock and the no-dig edge margin
 * both read as maximally hard, so the same deflection logic that bends
 * tunnels around clay also keeps a digger from wandering into ground it
 * could never actually open (SPEC's edge-margin invariant). */
function effectiveHardness(world: World, worldX: number, worldY: number, edgeMargin: number): number {
  const cx = Math.floor(worldX / world.cellSize);
  const cy = Math.floor(worldY / world.cellSize);
  if (!isDiggable(world, cx, cy, edgeMargin)) return 1;
  return sampleHardness(world, worldX, worldY);
}

/** Offsets a smoothed path's intermediate waypoints a little to one side of
 * its own centerline, so following it reads as walking near a wall rather
 * than dead center (SPEC's wall/floor hugging). Picked once per ant and
 * applied once per path, not sensed continuously, so it's cheap and never
 * jitters. Falls back to the unmodified point if the offset would land in
 * solid ground — and, since checking each offset point alone doesn't
 * guarantee the straight segments to its neighbors stay clear too (an ant
 * could otherwise visibly clip a corner right at a tunnel bend, exactly
 * where string-pulling likes to place a waypoint), a final pass confirms
 * every segment of the hugged path still has line of sight end to end,
 * discarding the whole offset for this path if not. */
function applyHugOffset(world: World, points: Point[], hugOffset: number): Point[] {
  if (Math.abs(hugOffset) < 0.01 || points.length <= 2) return points;
  const hugged: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const next = points[i + 1];
    const dirX = next.x - prev.x;
    const dirY = next.y - prev.y;
    const len = Math.hypot(dirX, dirY);
    if (len < 0.001) {
      hugged.push(points[i]);
      continue;
    }
    const perpX = -dirY / len;
    const perpY = dirX / len;
    const candidate = { x: points[i].x + perpX * hugOffset, y: points[i].y + perpY * hugOffset };
    const cx = Math.floor(candidate.x / world.cellSize);
    const cy = Math.floor(candidate.y / world.cellSize);
    hugged.push(isOpenCell(world, cx, cy) ? candidate : points[i]);
  }
  hugged.push(points[points.length - 1]);

  for (let i = 0; i < hugged.length - 1; i++) {
    if (!hasLineOfSight(world, hugged[i], hugged[i + 1])) return points;
  }
  return hugged;
}

/** Returns the ant's cached path to (targetX, targetY), computing and
 * caching a fresh one if the target has changed. See the note on `Ant.path`
 * for why no other invalidation is needed. */
function ensurePath(ant: Ant, world: World, targetX: number, targetY: number): Point[] | null {
  if (ant.path && ant.pathTargetX === targetX && ant.pathTargetY === targetY) return ant.path;

  const raw = findPath(world, ant.x, ant.y, targetX, targetY);
  if (!raw) return null;

  const path = applyHugOffset(world, stringPull(world, raw), ant.hugOffset);
  ant.path = path;
  ant.pathTargetX = targetX;
  ant.pathTargetY = targetY;
  ant.pathIndex = 0;
  return path;
}

/** Advances an ant along its current path one tick's worth. Returns true
 * once the final waypoint is reached. Shared by every travel phase. */
function followPath(ant: Ant, world: World, path: Point[], dt: number, movementCfg: MovementConfig, speedFactor: number): boolean {
  if (ant.pathIndex >= path.length) return true;

  const target = path[ant.pathIndex];
  const dx = target.x - ant.x;
  const dy = target.y - ant.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= movementCfg.waypointRadius) {
    ant.pathIndex++;
    return ant.pathIndex >= path.length;
  }

  const desiredHeading = Math.atan2(dy, dx);
  ant.heading = turnToward(ant.heading, desiredHeading, movementCfg.maxTurnRate, dt);
  const isFinal = ant.pathIndex === path.length - 1;
  const speedScale = isFinal ? arriveSpeedFactor(dist, movementCfg.arriveRadius) : 1;
  const speed = ant.baseSpeed * speedFactor * speedScale;
  // A path only ever visits open cells, so this shouldn't normally be able
  // to leave the world — but nothing here guarantees a single tick's step
  // can't overshoot past a waypoint right at the edge (the shallow entrance
  // notch reaches all the way to y=0), so clamp as a hard backstop, the same
  // way digging does.
  ant.x = Math.min(world.gridW * world.cellSize, Math.max(0, ant.x + Math.cos(ant.heading) * speed * dt));
  ant.y = Math.min(world.gridH * world.cellSize, Math.max(0, ant.y + Math.sin(ant.heading) * speed * dt));
  ant.currentSpeed = speed;
  return false;
}

function beginJob(ant: Ant, job: DigJob, planner: Planner): void {
  ant.currentJob = job;
  if (job.kind === 'shaft') {
    ant.pathTargetX = job.fromX;
    ant.pathTargetY = job.fromY;
  } else if (job.kind === 'connector') {
    ant.pathTargetX = job.fromX;
    ant.pathTargetY = job.fromY;
    ant.connectorTargetX = job.toX;
    ant.connectorTargetY = job.toY;
  } else {
    const chamber = planner.chambers.find((c) => c.id === job.chamberId);
    ant.pathTargetX = chamber ? chamber.connectorX : ant.x;
    ant.pathTargetY = chamber ? chamber.connectorY : ant.y;
  }
  ant.path = null;
  ant.pathIndex = 0;
  ant.phase = 'movingToJobSite';
}

function stepIdle(ant: Ant, world: World, planner: Planner, lifecycle: Lifecycle, foraging: Foraging, wanderCfg: WanderConfig): DiggerStepResult {
  if (ant.role === 'queen' || ant.role === 'digger') {
    const job = claimJob(planner);
    if (job) {
      beginJob(ant, job, planner);
      return { dirty: null };
    }
    // The queen only ever works dig jobs during founding — with none
    // available yet, she just waits rather than wandering off.
    if (ant.role === 'queen') return { dirty: null };
    pickWanderTarget(ant, world, wanderCfg);
    return { dirty: null };
  }
  if (ant.role === 'nurse') {
    ant.phase = 'nurseFetching';
    return { dirty: null };
  }
  if (ant.role === 'forager') {
    const hasFood = foraging.food.some((f) => !f.claimedByForager);
    if (!hasFood) {
      pickWanderTarget(ant, world, wanderCfg);
      return { dirty: null };
    }
    ant.phase = 'foragerToEntrance';
    return { dirty: null };
  }
  // idler
  pickWanderTarget(ant, world, wanderCfg);
  void lifecycle;
  return { dirty: null };
}

function stepMovingToJobSite(ant: Ant, world: World, planner: Planner, dt: number, movementCfg: MovementConfig, plannerCfg: PlannerConfig): DiggerStepResult {
  const path = ensurePath(ant, world, ant.pathTargetX, ant.pathTargetY);
  if (!path) {
    // The job site isn't reachable (shouldn't normally happen — every job
    // starts from ground the colony already dug) — drop the job rather
    // than getting stuck trying to reach it forever.
    ant.currentJob = null;
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };

  const job = ant.currentJob;
  if (!job) {
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (job.kind === 'shaft') {
    ant.heading = job.heading;
    ant.preferredHeading = job.heading;
    ant.leanAngle = job.heading;
    ant.shaftRemainingLength = job.targetLength;
    ant.phase = 'diggingShaft';
  } else if (job.kind === 'connector') {
    ant.heading = Math.atan2(job.toY - ant.y, job.toX - ant.x);
    ant.phase = 'diggingConnector';
  } else {
    const chamber = planner.chambers.find((c) => c.id === job.chamberId);
    if (!chamber) {
      ant.currentJob = null;
      ant.phase = 'idle';
      return { dirty: null };
    }
    ant.chamberSweep = chamberSweepPoints(chamber, plannerCfg.chamberBrushSpacing);
    ant.chamberSweepIndex = 0;
    ant.phase = 'diggingChamber';
  }
  return { dirty: null };
}

function startSurfaceTrip(ant: Ant): void {
  ant.carriedVolume = ant.diggingProgress;
  ant.diggingProgress = 0;
  ant.carryingItem = 'pellet';
  ant.jobResumeX = ant.x;
  ant.jobResumeY = ant.y;
  ant.jobResumeHeading = ant.heading;
  ant.jobResumePreferredHeading = ant.preferredHeading;
  ant.jobResumeLeanAngle = ant.leanAngle;
  ant.phase = 'movingToSurface';
}

function stepDiggingShaft(ant: Ant, world: World, planner: Planner, dt: number, diggingCfg: DiggingConfig): DiggerStepResult {
  const job = ant.currentJob;
  if (!job || job.kind !== 'shaft') {
    ant.phase = 'idle';
    return { dirty: null };
  }

  // The preferred heading wanders slowly on its own, gently pulled back
  // toward this job's lean angle — a smooth, continuous curve rather than a
  // path that snaps toward (and past) a fixed point.
  const wander = (ant.rng() - 0.5) * 2 * diggingCfg.wanderRate * dt;
  const pullToLean = angleDiff(ant.leanAngle, ant.preferredHeading) * diggingCfg.leanPullStrength * dt;
  ant.preferredHeading += wander + pullToLean;

  const noise = (ant.rng() - 0.5) * 2 * diggingCfg.headingNoise * dt;
  const towardPreferred = angleDiff(ant.preferredHeading, ant.heading) * diggingCfg.steeringStrength * dt;

  // Sample hardness a little to each side of the heading and turn toward
  // whichever side is softer, so tunnels visibly bend around clay and rock.
  const probe = world.cellSize * 2.5;
  const sideOffset = 0.35;
  const leftHardness = effectiveHardness(
    world,
    ant.x + Math.cos(ant.heading - sideOffset) * probe,
    ant.y + Math.sin(ant.heading - sideOffset) * probe,
    diggingCfg.edgeMarginCells,
  );
  const rightHardness = effectiveHardness(
    world,
    ant.x + Math.cos(ant.heading + sideOffset) * probe,
    ant.y + Math.sin(ant.heading + sideOffset) * probe,
    diggingCfg.edgeMarginCells,
  );
  const deflect = (leftHardness - rightHardness) * diggingCfg.hardnessDeflection * dt;

  ant.heading += noise + towardPreferred + deflect;

  const aheadHardness = effectiveHardness(
    world,
    ant.x + Math.cos(ant.heading) * probe,
    ant.y + Math.sin(ant.heading) * probe,
    diggingCfg.edgeMarginCells,
  );
  const speed = ant.baseSpeed * (1 - aheadHardness * diggingCfg.hardnessSlowdown);

  // Hardness only ever slows the ant down, never stops it outright — clay is
  // diggable, just slow. That's not enough of a wall by itself: at a high
  // dev time scale, hundreds of ticks can land inside the (fully
  // undiggable) edge margin before deflection has a chance to turn the
  // heading around, and the ant would just keep drifting through it forever.
  // Clamp the actual position to the diggable region as a hard backstop.
  const margin = diggingCfg.edgeMarginCells * world.cellSize;
  const minX = margin;
  const maxX = (world.gridW - diggingCfg.edgeMarginCells) * world.cellSize;
  const maxY = (world.gridH - diggingCfg.edgeMarginCells) * world.cellSize;

  const nx = Math.min(maxX, Math.max(minX, ant.x + Math.cos(ant.heading) * speed * dt));
  const ny = Math.min(maxY, Math.max(0, ant.y + Math.sin(ant.heading) * speed * dt));

  // The soft deflection above is only a nudge, not a guarantee — it can lose
  // to the pull back toward the lean angle and let the ant grind straight
  // into a rock formation wider than one deflection can route around, tunnel
  // or no tunnel be damned, wandering through solid ground it never actually
  // opened. Refuse the step outright if the destination isn't diggable. Only
  // retarget the *lean* here, not `heading` itself — the normal steering
  // above then curves heading toward it over the next several ticks, so the
  // tunnel bends away from the obstruction instead of snapping into a sharp
  // corner (repeated blocks just keep retargeting until it actually clears).
  if (!isDiggable(world, Math.floor(nx / world.cellSize), Math.floor(ny / world.cellSize), diggingCfg.edgeMarginCells)) {
    const kick = (ant.rng() < 0.5 ? -1 : 1) * diggingCfg.blockedTurnKick;
    ant.preferredHeading = ant.heading + kick;
    ant.leanAngle = ant.preferredHeading;
    return { dirty: null };
  }

  const result = digBrush(world, nx, ny, diggingCfg.brushRadiusCells, diggingCfg.brushRadiusCells, diggingCfg.edgeMarginCells);
  const movedDistance = Math.hypot(nx - ant.x, ny - ant.y);
  ant.x = nx;
  ant.y = ny;
  ant.currentSpeed = speed;
  ant.diggingProgress += result.volumeRemoved;
  ant.shaftRemainingLength -= movedDistance;
  recordShaftPoint(planner, job.shaftId, ant.x, ant.y);

  if (ant.diggingProgress >= diggingCfg.carryVolumeThreshold) {
    startSurfaceTrip(ant);
    return { dirty: result.dirty };
  }

  if (ant.shaftRemainingLength <= 0) {
    ant.currentJob = null;
    ant.phase = 'idle';
  }

  return { dirty: result.dirty };
}

/** Shared seek-and-carve movement for chamber and connector jobs: turn
 * toward a fixed target, move forward, dig a brush at the new position.
 * Simpler than a shaft's correlated random walk on purpose — both are
 * filling in a shape the planner already chose, not exploring, so there's
 * no wander or hardness deflection here. Refuses a step into rock the same
 * hard way shaft digging does, but just treats that as "this exact spot
 * didn't work out" rather than steering around it, since a chamber or
 * connector already has other nearby ground to make progress on. */
function seekAndDig(
  ant: Ant,
  world: World,
  dt: number,
  targetX: number,
  targetY: number,
  speedFactor: number,
  radiusX: number,
  radiusY: number,
  edgeMarginCells: number,
  arriveRadius: number,
): { arrived: boolean; dirty: DirtyRect | null } {
  const dx = targetX - ant.x;
  const dy = targetY - ant.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= arriveRadius) return { arrived: true, dirty: null };

  const desiredHeading = Math.atan2(dy, dx);
  ant.heading = turnToward(ant.heading, desiredHeading, Math.PI * 2, dt);
  const speed = ant.baseSpeed * speedFactor;
  const nx = ant.x + Math.cos(ant.heading) * speed * dt;
  const ny = ant.y + Math.sin(ant.heading) * speed * dt;

  if (!isDiggable(world, Math.floor(nx / world.cellSize), Math.floor(ny / world.cellSize), edgeMarginCells)) {
    return { arrived: false, dirty: null };
  }

  const result = digBrush(world, nx, ny, radiusX, radiusY, edgeMarginCells);
  ant.x = nx;
  ant.y = ny;
  ant.currentSpeed = speed;
  ant.diggingProgress += result.volumeRemoved;
  return { arrived: false, dirty: result.dirty };
}

function stepDiggingChamber(ant: Ant, world: World, planner: Planner, dt: number, diggingCfg: DiggingConfig): DiggerStepResult {
  const job = ant.currentJob;
  if (!job || job.kind !== 'chamber' || !ant.chamberSweep) {
    ant.phase = 'idle';
    return { dirty: null };
  }
  const chamber = planner.chambers.find((c) => c.id === job.chamberId);
  if (!chamber) {
    ant.currentJob = null;
    ant.phase = 'idle';
    return { dirty: null };
  }

  if (ant.chamberSweepIndex >= ant.chamberSweep.length) {
    chamber.done = true;
    ant.currentJob = null;
    ant.chamberSweep = null;
    // The queen's founding sequence ends the moment her royal chamber is
    // ready — she never claims another job (SPEC: "she settles").
    ant.phase = ant.role === 'queen' && chamber.type === 'royal' ? 'queenSettled' : 'idle';
    return { dirty: null };
  }

  const target = ant.chamberSweep[ant.chamberSweepIndex];
  const { arrived, dirty } = seekAndDig(
    ant,
    world,
    dt,
    target.x,
    target.y,
    diggingCfg.chamberSpeedFactor,
    diggingCfg.chamberRadiusXCells,
    diggingCfg.chamberRadiusYCells,
    diggingCfg.edgeMarginCells,
    world.cellSize,
  );
  if (arrived) ant.chamberSweepIndex++;

  if (ant.diggingProgress >= diggingCfg.carryVolumeThreshold) {
    startSurfaceTrip(ant);
  }
  return { dirty };
}

function stepDiggingConnector(ant: Ant, world: World, dt: number, diggingCfg: DiggingConfig): DiggerStepResult {
  const job = ant.currentJob;
  if (!job || job.kind !== 'connector') {
    ant.phase = 'idle';
    return { dirty: null };
  }

  const { arrived, dirty } = seekAndDig(
    ant,
    world,
    dt,
    ant.connectorTargetX,
    ant.connectorTargetY,
    1,
    diggingCfg.brushRadiusCells,
    diggingCfg.brushRadiusCells,
    diggingCfg.edgeMarginCells,
    world.cellSize * 1.5,
  );

  if (ant.diggingProgress >= diggingCfg.carryVolumeThreshold) {
    startSurfaceTrip(ant);
    return { dirty };
  }
  if (arrived) {
    ant.currentJob = null;
    ant.phase = 'idle';
  }
  return { dirty };
}

/**
 * Carries a pellet to the entrance and drops it there. SPEC frames this as
 * following the distance field's own gradient rather than a planned path —
 * cheaper, since the destination is really a direction ("closer") and not a
 * fixed point — and an earlier version of this function did exactly that:
 * probing nearby directions and steering toward whichever read a smaller
 * distance-to-entrance. In practice that couldn't reliably see around a
 * bend (a tunnel is never perfectly straight), so a probe far enough ahead
 * to be useful would often have to look straight through solid ground on
 * the inside of a curve, and a probe short enough to avoid that could dead
 * end with no valid direction at all right as a dig frontier's ground was
 * still mid-collapse. A* doesn't have either problem — it already reasons
 * about the tunnel's actual shape — so the trip home reuses the same
 * pathing every other trip does. The distance field itself stays in use
 * elsewhere (see `pickWanderTarget`) as a cheap reachability check.
 */
function stepMovingToSurface(ant: Ant, world: World, mound: Mound, dt: number, movementCfg: MovementConfig, diggingCfg: DiggingConfig): DiggerStepResult {
  const entrance = entrancePosition(world);

  const path = ensurePath(ant, world, entrance.x, entrance.y);
  if (!path) {
    // No route to the entrance found (shouldn't normally happen — the
    // colony's own invariant is that every open cell reaches it — but if it
    // ever does, don't strand the ant mid-trip forever).
    ant.phase = ant.currentJob ? phaseForJob(ant.currentJob) : 'idle';
    return { dirty: null };
  }

  if (!followPath(ant, world, path, dt, movementCfg, diggingCfg.carrySpeedFactor)) return { dirty: null };

  depositPellet(mound, ant.x, ant.carriedVolume);
  ant.carriedVolume = 0;
  ant.carryingItem = null;
  ant.path = null;
  ant.phase = 'returningToResume';
  return { dirty: null };
}

function phaseForJob(job: DigJob): AntPhase {
  if (job.kind === 'shaft') return 'diggingShaft';
  if (job.kind === 'chamber') return 'diggingChamber';
  return 'diggingConnector';
}

function stepReturningToResume(ant: Ant, world: World, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const path = ensurePath(ant, world, ant.jobResumeX, ant.jobResumeY);
  if (!path) {
    ant.phase = ant.currentJob ? phaseForJob(ant.currentJob) : 'idle';
    return { dirty: null };
  }

  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };

  ant.x = ant.jobResumeX;
  ant.y = ant.jobResumeY;
  ant.heading = ant.jobResumeHeading;
  ant.preferredHeading = ant.jobResumePreferredHeading;
  ant.leanAngle = ant.jobResumeLeanAngle;
  ant.path = null;
  ant.phase = ant.currentJob ? phaseForJob(ant.currentJob) : 'idle';
  return { dirty: null };
}

function pickWanderTarget(ant: Ant, world: World, wanderCfg: WanderConfig): void {
  for (let attempt = 0; attempt < 8; attempt++) {
    const radius = wanderCfg.wanderRadiusMin + ant.rng() * (wanderCfg.wanderRadiusMax - wanderCfg.wanderRadiusMin);
    const angle = ant.rng() * Math.PI * 2;
    const cx = Math.floor((ant.x + Math.cos(angle) * radius) / world.cellSize);
    const cy = Math.floor((ant.y + Math.sin(angle) * radius) / world.cellSize);
    if (!isOpenCell(world, cx, cy)) continue;
    if (world.distanceField[cy * world.gridW + cx] === Infinity) continue;

    ant.pathTargetX = (cx + 0.5) * world.cellSize;
    ant.pathTargetY = (cy + 0.5) * world.cellSize;
    ant.path = null;
    ant.pathIndex = 0;
    ant.phase = 'movingToTarget';
    return;
  }
  // Nowhere reachable nearby yet (e.g. very early in a session, before much
  // is dug) — just try again shortly rather than getting stuck searching.
  ant.wanderPauseRemaining = 0.5;
  ant.phase = 'pausing';
}

function stepWanderer(ant: Ant, world: World, dt: number, movementCfg: MovementConfig, wanderCfg: WanderConfig): DiggerStepResult {
  if (ant.phase === 'pausing') {
    ant.wanderPauseRemaining -= dt;
    if (ant.wanderPauseRemaining <= 0) ant.phase = 'idle';
    return { dirty: null };
  }

  const path = ensurePath(ant, world, ant.pathTargetX, ant.pathTargetY);
  if (!path) {
    pickWanderTarget(ant, world, wanderCfg);
    return { dirty: null };
  }

  if (followPath(ant, world, path, dt, movementCfg, 1)) {
    ant.phase = 'pausing';
    ant.wanderPauseRemaining =
      wanderCfg.wanderPauseMinSeconds + ant.rng() * (wanderCfg.wanderPauseMaxSeconds - wanderCfg.wanderPauseMinSeconds);
  }
  return { dirty: null };
}

// --- queen founding sequence ---

/** Smoothstep: eases in and out rather than moving at a constant rate, so
 * the glide/walk read as gentle motion rather than a mechanical slide. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function stepQueenGliding(ant: Ant, world: World, dt: number, focusRunning: boolean, queenCfg: QueenConfig): DiggerStepResult {
  if (!focusRunning) return { dirty: null };
  ant.queenPhaseTimer += dt;
  const entrance = entrancePosition(world);
  const t = Math.min(1, ant.queenPhaseTimer / queenCfg.glideSeconds);
  const eased = smoothstep(t);
  // A gentle side-to-side wander that settles out as she nears the ground,
  // rather than a straight drop (SPEC: "gentle, slightly wandering glide").
  const wander = Math.sin(t * Math.PI * 3) * queenCfg.glideWander * (1 - eased);
  ant.x = entrance.x + wander;
  ant.y = -queenCfg.glideStartHeight * (1 - eased);
  ant.heading = Math.PI / 2 + Math.sin(t * Math.PI * 3) * 0.3;
  ant.currentSpeed = queenCfg.speed;
  if (t >= 1) {
    ant.phase = 'queenWalking';
    ant.queenPhaseTimer = 0;
  }
  return { dirty: null };
}

function stepQueenWalking(ant: Ant, world: World, dt: number, focusRunning: boolean, queenCfg: QueenConfig): DiggerStepResult {
  if (!focusRunning) return { dirty: null };
  ant.queenPhaseTimer += dt;
  const entrance = entrancePosition(world);
  const t = Math.min(1, ant.queenPhaseTimer / queenCfg.walkAfterLandSeconds);
  const eased = smoothstep(t);
  ant.x = entrance.x + ant.queenLandOffsetX * (1 - eased);
  ant.y = entrance.y;
  ant.heading = ant.queenLandOffsetX >= 0 ? Math.PI : 0;
  // SPEC: "wings flutter to the ground and fade" — starts fading partway
  // through the walk, gone well before she starts digging.
  ant.wingsAlpha = Math.max(0, 1 - t * 1.5);
  ant.currentSpeed = t < 1 ? queenCfg.speed * 0.4 : 0;
  if (t >= 1) {
    ant.phase = 'idle'; // claims the waiting founding shaft job next tick
    ant.queenPhaseTimer = 0;
  }
  return { dirty: null };
}

// --- nurse: carries brood from the royal chamber to the nursery ---

function stepNurseFetching(ant: Ant, world: World, lifecycle: Lifecycle, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  if (ant.carriedBroodId === null) {
    const item = lifecycle.brood.find((b) => !b.inNursery && !b.claimedByNurse);
    if (!item) {
      ant.phase = 'idle';
      return { dirty: null };
    }
    item.claimedByNurse = true;
    ant.carriedBroodId = item.id;
    ant.pathTargetX = item.x;
    ant.pathTargetY = item.y;
    ant.path = null;
    ant.pathIndex = 0;
  }

  const path = ensurePath(ant, world, ant.pathTargetX, ant.pathTargetY);
  if (!path) {
    releaseNurseClaim(ant, lifecycle);
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };

  const item = lifecycle.brood.find((b) => b.id === ant.carriedBroodId);
  if (!item) {
    ant.carriedBroodId = null;
    ant.phase = 'idle';
    return { dirty: null };
  }
  ant.carryingItem = item.stage;
  ant.path = null;
  ant.phase = 'nurseCarrying';
  return { dirty: null };
}

function stepNurseCarrying(ant: Ant, world: World, planner: Planner, lifecycle: Lifecycle, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const item = lifecycle.brood.find((b) => b.id === ant.carriedBroodId);
  if (!item) {
    ant.carriedBroodId = null;
    ant.carryingItem = null;
    ant.phase = 'idle';
    return { dirty: null };
  }
  const nursery = planner.chambers.find((c) => c.type === 'nursery');
  if (!nursery) {
    releaseNurseClaim(ant, lifecycle);
    ant.phase = 'idle';
    return { dirty: null };
  }

  const path = ensurePath(ant, world, nursery.x, nursery.y);
  if (!path) {
    releaseNurseClaim(ant, lifecycle);
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) {
    item.x = ant.x;
    item.y = ant.y;
    return { dirty: null };
  }

  item.x = nursery.x;
  item.y = nursery.y;
  item.inNursery = true;
  item.claimedByNurse = false;
  ant.carriedBroodId = null;
  ant.carryingItem = null;
  ant.path = null;
  ant.phase = 'idle';
  return { dirty: null };
}

function releaseNurseClaim(ant: Ant, lifecycle: Lifecycle): void {
  if (ant.carriedBroodId === null) return;
  const item = lifecycle.brood.find((b) => b.id === ant.carriedBroodId);
  if (item) item.claimedByNurse = false;
  ant.carriedBroodId = null;
  ant.carryingItem = null;
}

// --- forager: walks the surface for food, brings it to the granary ---

/** How close a surface ant needs to be to an active surface surprise (SPEC:
 * "surface ants pause as a beetle passes") before it pauses for it. */
const SURPRISE_PAUSE_RADIUS = 24;

/** A straight-line walk along the surface (constant y) — there's nothing up
 * there to path around, unlike underground. `pauseNearX` briefly holds the
 * ant still rather than advancing it (SPEC section 6 "small surprises":
 * "ants react lightly, for example surface ants pause as a beetle passes") —
 * a light touch since the ant just resumes on its own the moment the
 * surprise moves on, no separate "resume" state needed. */
function seekSurface(ant: Ant, dt: number, targetX: number, y: number, arriveRadius: number, pauseNearX: number | null): boolean {
  const dx = targetX - ant.x;
  ant.y = y;
  if (Math.abs(dx) <= arriveRadius) return true;
  if (pauseNearX !== null && Math.abs(ant.x - pauseNearX) < SURPRISE_PAUSE_RADIUS) {
    ant.currentSpeed = 0;
    return false;
  }
  const desiredHeading = dx > 0 ? 0 : Math.PI;
  ant.heading = turnToward(ant.heading, desiredHeading, Math.PI * 2, dt);
  const speed = ant.baseSpeed;
  ant.x += Math.cos(ant.heading) * speed * dt;
  ant.currentSpeed = speed;
  return false;
}

/** How far above the grass line foragers (and the food they're after) sit —
 * exported so the renderer draws food at exactly the height a forager will
 * actually walk to. */
export const FORAGER_SURFACE_Y = -3;

function stepForagerToEntrance(ant: Ant, world: World, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const entrance = entrancePosition(world);
  const path = ensurePath(ant, world, entrance.x, entrance.y);
  if (!path) {
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };
  ant.path = null;
  ant.phase = 'foragerToFood';
  return { dirty: null };
}

function stepForagerToFood(ant: Ant, dt: number, foraging: Foraging, surfaceSurpriseX: number | null): DiggerStepResult {
  if (ant.claimedFoodId === null) {
    const item = foraging.food.find((f) => !f.claimedByForager);
    if (!item) {
      ant.phase = 'idle';
      return { dirty: null };
    }
    item.claimedByForager = true;
    ant.claimedFoodId = item.id;
  }
  const item = foraging.food.find((f) => f.id === ant.claimedFoodId);
  if (!item) {
    ant.claimedFoodId = null;
    ant.phase = 'idle';
    return { dirty: null };
  }

  if (seekSurface(ant, dt, item.x, FORAGER_SURFACE_Y, 3, surfaceSurpriseX)) {
    ant.carryingItem = item.kind;
    foraging.food = foraging.food.filter((f) => f.id !== item.id);
    ant.claimedFoodId = null;
    ant.phase = 'foragerReturning';
  }
  return { dirty: null };
}

function stepForagerReturning(ant: Ant, world: World, dt: number, surfaceSurpriseX: number | null): DiggerStepResult {
  const entrance = entrancePosition(world);
  if (seekSurface(ant, dt, entrance.x, FORAGER_SURFACE_Y, 3, surfaceSurpriseX)) {
    // Step down into the entrance before the next phase paths underground —
    // A* can't compute a route starting from the surface (y < 0 is outside
    // the world grid entirely), the same reason `foragerToFood` snaps back
    // up to the surface the moment it starts.
    ant.y = entrance.y;
    ant.path = null;
    ant.phase = 'foragerToGranary';
  }
  return { dirty: null };
}

function stepForagerToGranary(ant: Ant, world: World, planner: Planner, foraging: Foraging, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const granary = planner.chambers.find((c) => c.type === 'granary');
  if (!granary) {
    ant.carryingItem = null;
    ant.phase = 'idle';
    return { dirty: null };
  }
  const path = ensurePath(ant, world, granary.x, granary.y);
  if (!path) {
    ant.carryingItem = null;
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };

  foraging.granaryStored++;
  ant.carryingItem = null;
  ant.path = null;
  ant.phase = 'idle';
  return { dirty: null };
}

// --- rain: plugging/unplugging the entrance (SPEC section 6) ---

/** Both jobs path from wherever the ant currently is (usually underground)
 * to the entrance, the same way `stepForagerToEntrance` does — the only
 * difference is which flag they report once they arrive. */
function stepPlugEntrance(ant: Ant, world: World, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const entrance = entrancePosition(world);
  const path = ensurePath(ant, world, entrance.x, entrance.y);
  if (!path) {
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };
  ant.path = null;
  ant.phase = 'idle';
  return { dirty: null, entrancePlugChange: 'plugged' };
}

function stepUnplugEntrance(ant: Ant, world: World, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const entrance = entrancePosition(world);
  const path = ensurePath(ant, world, entrance.x, entrance.y);
  if (!path) {
    ant.phase = 'idle';
    return { dirty: null };
  }
  if (!followPath(ant, world, path, dt, movementCfg, 1)) return { dirty: null };
  ant.path = null;
  ant.phase = 'idle';
  return { dirty: null, entrancePlugChange: 'unplugged' };
}

// --- resting: SPEC section 2, while focus is paused ---

/** Phases safe to interrupt immediately when focus pauses — either not yet
 * doing anything productive (idle/wandering), or mid-productive-action in a
 * way simple enough to just stop (a digger doesn't finish the current brush
 * stroke, it just stops there — SPEC's "finishes its current small action"
 * taken at fairly fine grain). Phases *not* in this set are short travel
 * legs already carrying something or already committed to a specific trip
 * (a pellet, an egg, a food item, a walk to a job site) — those finish
 * rather than abandoning something mid-tunnel, and the ant rests as soon as
 * that trip's own logic naturally reaches an interruptible phase. */
const RESTS_IMMEDIATELY: ReadonlySet<AntPhase> = new Set([
  'idle',
  'movingToTarget',
  'pausing',
  'diggingShaft',
  'diggingChamber',
  'diggingConnector',
  'nurseFetching',
  'foragerToFood',
]);

function enterResting(ant: Ant, world: World, planner: Planner, lifecycle: Lifecycle, foraging: Foraging): void {
  releaseNurseClaim(ant, lifecycle);
  if (ant.claimedFoodId !== null) {
    const item = foraging.food.find((f) => f.id === ant.claimedFoodId);
    if (item) item.claimedByForager = false;
    ant.claimedFoodId = null;
  }
  ant.currentJob = null;

  const restingChamber = planner.chambers.find((c) => c.type === 'resting') ?? planner.chambers.find((c) => c.type === 'royal');
  const target = restingChamber ? { x: restingChamber.x, y: restingChamber.y } : entrancePosition(world);
  ant.pathTargetX = target.x;
  ant.pathTargetY = target.y;
  ant.path = null;
  ant.pathIndex = 0;
  ant.phase = 'resting';
}

function stepResting(ant: Ant, world: World, dt: number, movementCfg: MovementConfig): DiggerStepResult {
  const path = ensurePath(ant, world, ant.pathTargetX, ant.pathTargetY);
  if (!path) return { dirty: null };
  followPath(ant, world, path, dt, movementCfg, 1);
  return { dirty: null };
}

export function stepAnt(ant: Ant, ctx: AntStepContext, dt: number, cfg: AntStepConfig): DiggerStepResult {
  // Defaults to "not moving" each tick; the phase handlers below overwrite
  // this wherever they actually translate the ant.
  ant.currentSpeed = 0;
  // SPEC section 6: "movement speed × 0.8" at night, blended smoothly by
  // night factor rather than snapping — every phase handler below reads
  // `ant.baseSpeed`, so recomputing it once here covers all of them.
  ant.baseSpeed = ant.baseSpeedUnscaled * (1 - ctx.nightFactor * (1 - cfg.movement.nightSpeedFactor));

  if (!ctx.focusRunning && ant.phase !== 'resting' && RESTS_IMMEDIATELY.has(ant.phase)) {
    enterResting(ant, ctx.world, ctx.planner, ctx.lifecycle, ctx.foraging);
  } else if (ctx.focusRunning && ant.phase === 'resting') {
    ant.phase = 'idle';
  }

  switch (ant.phase) {
    case 'queenGliding':
      return stepQueenGliding(ant, ctx.world, dt, ctx.focusRunning, cfg.queen);
    case 'queenWalking':
      return stepQueenWalking(ant, ctx.world, dt, ctx.focusRunning, cfg.queen);
    case 'queenSettled':
      return { dirty: null };
    case 'idle':
      return stepIdle(ant, ctx.world, ctx.planner, ctx.lifecycle, ctx.foraging, cfg.wander);
    case 'movingToJobSite':
      return stepMovingToJobSite(ant, ctx.world, ctx.planner, dt, cfg.movement, cfg.planner);
    case 'diggingShaft':
      return stepDiggingShaft(ant, ctx.world, ctx.planner, dt, cfg.digging);
    case 'diggingChamber':
      return stepDiggingChamber(ant, ctx.world, ctx.planner, dt, cfg.digging);
    case 'diggingConnector':
      return stepDiggingConnector(ant, ctx.world, dt, cfg.digging);
    case 'movingToSurface':
      return stepMovingToSurface(ant, ctx.world, ctx.mound, dt, cfg.movement, cfg.digging);
    case 'returningToResume':
      return stepReturningToResume(ant, ctx.world, dt, cfg.movement);
    case 'nurseFetching':
      return stepNurseFetching(ant, ctx.world, ctx.lifecycle, dt, cfg.movement);
    case 'nurseCarrying':
      return stepNurseCarrying(ant, ctx.world, ctx.planner, ctx.lifecycle, dt, cfg.movement);
    case 'foragerToEntrance':
      return stepForagerToEntrance(ant, ctx.world, dt, cfg.movement);
    case 'foragerToFood':
      return stepForagerToFood(ant, dt, ctx.foraging, ctx.surfaceSurpriseX);
    case 'foragerReturning':
      return stepForagerReturning(ant, ctx.world, dt, ctx.surfaceSurpriseX);
    case 'foragerToGranary':
      return stepForagerToGranary(ant, ctx.world, ctx.planner, ctx.foraging, dt, cfg.movement);
    case 'plugEntrance':
      return stepPlugEntrance(ant, ctx.world, dt, cfg.movement);
    case 'unplugEntrance':
      return stepUnplugEntrance(ant, ctx.world, dt, cfg.movement);
    case 'movingToTarget':
    case 'pausing':
      return stepWanderer(ant, ctx.world, dt, cfg.movement, cfg.wander);
    case 'resting':
      return stepResting(ant, ctx.world, dt, cfg.movement);
  }
}

export type { ChamberType };
