// A single digger ant (SPEC section 5): a correlated random walk at the dig
// face, biased by a slowly wandering "preferred heading" (a persistent
// gentle per-seed lean, like a real shaft, plus slow drift — SPEC's "gentle
// lean and optional slow spiral tendency"), and deflected away from harder
// ground and the edge margin. On top of that, two behaviors stand in for the
// real colony planner (M4), which doesn't exist yet:
//
// - Branching: every so often the ant backtracks partway along its own
//   trail and heads off in a new direction. Almost every fork is a short
//   side branch that digs a bounded distance and then turns back to resume
//   the shaft it came from (SPEC: "chambers budding off the sides" of a
//   shaft, not a sprawl of equally-important tunnels); only rarely does a
//   fork become a new shaft in its own right, capped at a handful total
//   (SPEC: "secondary shafts branch off... and descend on their own").
// - Chambers: every so often it pauses and digs with a much wider, flatter
//   brush for a while, opening a small rounded bubble instead of a tunnel.
//
// Neither is the real thing — there's no chamber type, no site scoring, no
// need-driven job queue, just a lone ant with two extra habits. No pathing
// exists yet (M3) either, so return trips (to the surface, or back to a
// shaft after a side branch) simply retrace the breadcrumb trail left while
// digging — a temporary stand-in for the real distance-field/A* pathing,
// cheap enough for one ant over one session.
import type { Rng } from '../rng';
import { createStream } from '../rng';
import type { Mound } from '../surface/mound';
import { depositPellet } from '../surface/mound';
import type { DirtyRect, World } from '../world';
import { digBrush, isDiggable, sampleHardness } from '../world';

export type DiggerPhase = 'digging' | 'goingUp' | 'goingDown' | 'backtracking' | 'returningToParent';

interface Breadcrumb {
  x: number;
  y: number;
  heading: number;
}

export interface Digger {
  x: number;
  y: number;
  heading: number;
  /** Slowly wanders on its own; `heading` chases it. Keeps the path smooth
   * and continuous instead of snapping toward a point. */
  preferredHeading: number;
  /** This digger's persistent gentle lean off straight down for whichever
   * shaft it's currently on (SPEC: "main shaft... with gentle lean"). */
  leanAngle: number;
  phase: DiggerPhase;
  carriedVolume: number;
  diggingProgress: number;
  /** >0 while digging a chamber: brush radii widen and speed drops. */
  chamberTicksRemaining: number;
  breadcrumbs: Breadcrumb[];
  breadcrumbIndex: number;
  /** Where `backtracking`/`returningToParent` is walking back to. */
  backtrackTargetIndex: number;
  /** Fractional progress toward the next breadcrumb while retracing the
   * trail, so travel can run slower than digging (SPEC: "carrying 80% of
   * normal") without needing full path-following (that's M3). */
  pathProgress: number;
  /** How many shafts (the initial descent plus any forks promoted to a shaft
   * of their own) exist so far, capped by `maxMajorShafts`. */
  majorShaftCount: number;
  /** True while digging a bounded side branch off a shaft — suppresses
   * further branching until it returns, so side branches stay simple single
   * arms instead of sprouting their own sub-branches. */
  onSideBranch: boolean;
  sideBranchVolumeRemaining: number;
  /** The fork point to return to once a side branch's budget runs out. */
  sideBranchForkIndex: number;
  /** The shaft's heading/lean at the moment a branch started, restored when
   * a side branch (but not a promoted major shaft) returns. */
  parentHeading: number;
  parentPreferredHeading: number;
  parentLeanAngle: number;
  /** Computed once when a branch starts (while `heading` still faces
   * forward, before backtracking reverses it) and applied on arrival. */
  pendingForkAngle: number;
  pendingIsMajorShaft: boolean;
  rng: Rng;
}

export interface DiggerConfig {
  wanderRate: number;
  leanPullStrength: number;
  leanRange: number;
  headingNoise: number;
  steeringStrength: number;
  hardnessDeflection: number;
  hardnessSlowdown: number;
  baseSpeed: number;
  carrySpeedFactor: number;
  brushRadiusCells: number;
  carryVolumeThreshold: number;
  edgeMarginCells: number;
  blockedTurnKick: number;
  branchChance: number;
  branchMinBreadcrumbs: number;
  branchBacktrackMinSteps: number;
  branchBacktrackMaxSteps: number;
  branchAngleMin: number;
  branchAngleMax: number;
  maxMajorShafts: number;
  majorShaftChance: number;
  sideBranchVolumeMin: number;
  sideBranchVolumeMax: number;
  chamberChance: number;
  chamberDurationTicks: number;
  chamberRadiusXCells: number;
  chamberRadiusYCells: number;
  chamberSpeedFactor: number;
}

export function createDigger(
  seed: string,
  startX: number,
  startY: number,
  cfg: DiggerConfig,
): Digger {
  const rng = createStream(seed, 'ants:digger');
  const leanAngle = Math.PI / 2 + (rng() - 0.5) * cfg.leanRange;
  return {
    x: startX,
    y: startY,
    heading: leanAngle,
    preferredHeading: leanAngle,
    leanAngle,
    phase: 'digging',
    carriedVolume: 0,
    diggingProgress: 0,
    chamberTicksRemaining: 0,
    breadcrumbs: [{ x: startX, y: startY, heading: leanAngle }],
    breadcrumbIndex: 0,
    backtrackTargetIndex: 0,
    pathProgress: 0,
    majorShaftCount: 1, // the initial descent counts as the first shaft
    onSideBranch: false,
    sideBranchVolumeRemaining: 0,
    sideBranchForkIndex: 0,
    parentHeading: leanAngle,
    parentPreferredHeading: leanAngle,
    parentLeanAngle: leanAngle,
    pendingForkAngle: leanAngle,
    pendingIsMajorShaft: false,
    rng,
  };
}

function angleDiff(target: number, from: number): number {
  let d = (target - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface DiggerStepResult {
  dirty: DirtyRect | null;
}

/** Hardness for steering purposes: solid rock and the no-dig edge margin
 * both read as maximally hard, so the same deflection logic that bends
 * tunnels around clay also keeps the digger from wandering into ground it
 * could never actually open (SPEC's edge-margin invariant). */
function effectiveHardness(world: World, worldX: number, worldY: number, edgeMargin: number): number {
  const cx = Math.floor(worldX / world.cellSize);
  const cy = Math.floor(worldY / world.cellSize);
  if (!isDiggable(world, cx, cy, edgeMargin)) return 1;
  return sampleHardness(world, worldX, worldY);
}

function startBranch(digger: Digger, cfg: DiggerConfig): void {
  const stepsBack = Math.round(
    cfg.branchBacktrackMinSteps + digger.rng() * (cfg.branchBacktrackMaxSteps - cfg.branchBacktrackMinSteps),
  );
  digger.backtrackTargetIndex = Math.max(0, digger.breadcrumbs.length - 1 - stepsBack);
  digger.breadcrumbIndex = digger.breadcrumbs.length - 1;
  digger.pathProgress = 0;

  // Capture the parent shaft's state now, while `heading` still faces
  // forward — backtracking is about to reverse it, and the fork angle needs
  // to be measured off the real direction, not the reversed one.
  digger.parentHeading = digger.heading;
  digger.parentPreferredHeading = digger.preferredHeading;
  digger.parentLeanAngle = digger.leanAngle;

  const magnitude = cfg.branchAngleMin + digger.rng() * (cfg.branchAngleMax - cfg.branchAngleMin);
  const sign = digger.rng() < 0.5 ? -1 : 1;
  digger.pendingForkAngle = digger.heading + magnitude * sign;

  digger.pendingIsMajorShaft =
    digger.majorShaftCount < cfg.maxMajorShafts && digger.rng() < cfg.majorShaftChance;
  if (!digger.pendingIsMajorShaft) {
    digger.sideBranchForkIndex = digger.backtrackTargetIndex;
    digger.sideBranchVolumeRemaining =
      cfg.sideBranchVolumeMin + digger.rng() * (cfg.sideBranchVolumeMax - cfg.sideBranchVolumeMin);
  }

  digger.phase = 'backtracking';
}

function stepDigging(
  digger: Digger,
  world: World,
  dt: number,
  cfg: DiggerConfig,
): DiggerStepResult {
  if (digger.chamberTicksRemaining <= 0) {
    if (digger.rng() < cfg.chamberChance * dt) {
      digger.chamberTicksRemaining = cfg.chamberDurationTicks;
    } else if (
      !digger.onSideBranch &&
      digger.breadcrumbs.length > cfg.branchMinBreadcrumbs &&
      digger.rng() < cfg.branchChance * dt
    ) {
      startBranch(digger, cfg);
      return { dirty: null };
    }
  }

  // The preferred heading wanders slowly on its own, gently pulled back
  // toward this digger's lean angle — a smooth, continuous curve rather than
  // a path that snaps toward (and past) a fixed point.
  const wander = (digger.rng() - 0.5) * 2 * cfg.wanderRate * dt;
  const pullToLean = angleDiff(digger.leanAngle, digger.preferredHeading) * cfg.leanPullStrength * dt;
  digger.preferredHeading += wander + pullToLean;

  const noise = (digger.rng() - 0.5) * 2 * cfg.headingNoise * dt;
  const towardPreferred = angleDiff(digger.preferredHeading, digger.heading) * cfg.steeringStrength * dt;

  // Sample hardness a little to each side of the heading and turn toward
  // whichever side is softer, so tunnels visibly bend around clay and rock.
  const probe = world.cellSize * 2.5;
  const sideOffset = 0.35;
  const leftHardness = effectiveHardness(
    world,
    digger.x + Math.cos(digger.heading - sideOffset) * probe,
    digger.y + Math.sin(digger.heading - sideOffset) * probe,
    cfg.edgeMarginCells,
  );
  const rightHardness = effectiveHardness(
    world,
    digger.x + Math.cos(digger.heading + sideOffset) * probe,
    digger.y + Math.sin(digger.heading + sideOffset) * probe,
    cfg.edgeMarginCells,
  );
  const deflect = (leftHardness - rightHardness) * cfg.hardnessDeflection * dt;

  digger.heading += noise + towardPreferred + deflect;

  const aheadHardness = effectiveHardness(
    world,
    digger.x + Math.cos(digger.heading) * probe,
    digger.y + Math.sin(digger.heading) * probe,
    cfg.edgeMarginCells,
  );

  const carvingChamber = digger.chamberTicksRemaining > 0;
  const speedFactor = carvingChamber ? cfg.chamberSpeedFactor : 1;
  const speed = cfg.baseSpeed * speedFactor * (1 - aheadHardness * cfg.hardnessSlowdown);

  // Hardness only ever slows the ant down, never stops it outright — clay is
  // diggable, just slow. That's not enough of a wall by itself: at a high
  // dev time scale, hundreds of ticks can land inside the (fully
  // undiggable) edge margin before deflection has a chance to turn the
  // heading around, and the ant would just keep drifting through it forever.
  // Clamp the actual position to the diggable region as a hard backstop.
  const margin = cfg.edgeMarginCells * world.cellSize;
  const minX = margin;
  const maxX = (world.gridW - cfg.edgeMarginCells) * world.cellSize;
  const maxY = (world.gridH - cfg.edgeMarginCells) * world.cellSize;

  const nx = Math.min(maxX, Math.max(minX, digger.x + Math.cos(digger.heading) * speed * dt));
  const ny = Math.min(maxY, Math.max(0, digger.y + Math.sin(digger.heading) * speed * dt));

  // The soft deflection above is only a nudge, not a guarantee — it can lose
  // to the pull back toward the lean angle and let the ant grind straight
  // into a rock formation wider than one deflection can route around, tunnel
  // or no tunnel be damned, wandering through solid ground it never actually
  // opened. Refuse the step outright if the destination isn't diggable. Only
  // retarget the *lean* here, not `heading` itself — the normal steering
  // above then curves heading toward it over the next several ticks, so the
  // tunnel bends away from the obstruction instead of snapping into a sharp
  // corner (repeated blocks just keep retargeting until it actually clears).
  if (!isDiggable(world, Math.floor(nx / world.cellSize), Math.floor(ny / world.cellSize), cfg.edgeMarginCells)) {
    const kick = (digger.rng() < 0.5 ? -1 : 1) * cfg.blockedTurnKick;
    digger.preferredHeading = digger.heading + kick;
    digger.leanAngle = digger.preferredHeading;
    return { dirty: null };
  }

  const radiusX = carvingChamber ? cfg.chamberRadiusXCells : cfg.brushRadiusCells;
  const radiusY = carvingChamber ? cfg.chamberRadiusYCells : cfg.brushRadiusCells;
  const result = digBrush(world, nx, ny, radiusX, radiusY, cfg.edgeMarginCells);
  digger.x = nx;
  digger.y = ny;
  digger.diggingProgress += result.volumeRemoved;
  digger.breadcrumbs.push({ x: nx, y: ny, heading: digger.heading });

  if (carvingChamber) digger.chamberTicksRemaining--;

  if (digger.onSideBranch) {
    digger.sideBranchVolumeRemaining -= result.volumeRemoved;
    if (digger.sideBranchVolumeRemaining <= 0) {
      digger.backtrackTargetIndex = digger.sideBranchForkIndex;
      digger.breadcrumbIndex = digger.breadcrumbs.length - 1;
      digger.pathProgress = 0;
      digger.phase = 'returningToParent';
      return { dirty: result.dirty };
    }
  }

  if (digger.diggingProgress >= cfg.carryVolumeThreshold) {
    digger.carriedVolume = digger.diggingProgress;
    digger.diggingProgress = 0;
    digger.phase = 'goingUp';
    digger.breadcrumbIndex = digger.breadcrumbs.length - 1;
  }

  return { dirty: result.dirty };
}

function stepGoingUp(digger: Digger, mound: Mound, cfg: DiggerConfig): DiggerStepResult {
  digger.pathProgress += cfg.carrySpeedFactor;
  if (digger.pathProgress < 1) return { dirty: null };
  digger.pathProgress -= 1;

  if (digger.breadcrumbIndex <= 0) {
    depositPellet(mound, digger.x, digger.carriedVolume);
    digger.carriedVolume = 0;
    digger.phase = 'goingDown';
    return { dirty: null };
  }
  digger.breadcrumbIndex--;
  const at = digger.breadcrumbs[digger.breadcrumbIndex];
  digger.x = at.x;
  digger.y = at.y;
  digger.heading = at.heading + Math.PI;
  return { dirty: null };
}

function stepGoingDown(digger: Digger, cfg: DiggerConfig): DiggerStepResult {
  digger.pathProgress += cfg.carrySpeedFactor;
  if (digger.pathProgress < 1) return { dirty: null };
  digger.pathProgress -= 1;

  if (digger.breadcrumbIndex >= digger.breadcrumbs.length - 1) {
    digger.phase = 'digging';
    return { dirty: null };
  }
  digger.breadcrumbIndex++;
  const at = digger.breadcrumbs[digger.breadcrumbIndex];
  digger.x = at.x;
  digger.y = at.y;
  digger.heading = at.heading;
  return { dirty: null };
}

/**
 * Walks back along the trail toward `backtrackTargetIndex`. On arrival,
 * forks: forgets the breadcrumbs beyond this point (the old continuation
 * stays dug — density never refills — but the new branch is what the ant,
 * and any future trip back to the surface or back to this fork, actually
 * follows from here), and arms the fork angle computed back in
 * `startBranch` as a *target* rather than snapping to it. `heading` resumes
 * facing the way the shaft was originally going, and normal steering curves
 * it toward the new lean over the next stretch of digging — a smooth fork
 * peeling away from the trunk, not a sharp corner. A promoted major shaft
 * just keeps going; a side branch also gets its return budget armed.
 */
function stepBacktracking(digger: Digger, cfg: DiggerConfig): DiggerStepResult {
  digger.pathProgress += cfg.carrySpeedFactor;
  if (digger.pathProgress < 1) return { dirty: null };
  digger.pathProgress -= 1;

  if (digger.breadcrumbIndex <= digger.backtrackTargetIndex) {
    digger.heading = digger.parentHeading;
    digger.preferredHeading = digger.pendingForkAngle;
    digger.leanAngle = digger.pendingForkAngle;
    digger.breadcrumbs.length = digger.breadcrumbIndex + 1;
    if (digger.pendingIsMajorShaft) {
      digger.majorShaftCount++;
      digger.onSideBranch = false;
    } else {
      digger.onSideBranch = true;
    }
    digger.phase = 'digging';
    return { dirty: null };
  }
  digger.breadcrumbIndex--;
  const at = digger.breadcrumbs[digger.breadcrumbIndex];
  digger.x = at.x;
  digger.y = at.y;
  digger.heading = at.heading + Math.PI;
  return { dirty: null };
}

/**
 * The return half of a bounded side branch: walks back to the fork point,
 * the same way `stepBacktracking` does, but on arrival restores the parent
 * shaft's heading/lean instead of picking a new one, so digging resumes
 * exactly as if the side branch had never interrupted it.
 */
function stepReturningToParent(digger: Digger, cfg: DiggerConfig): DiggerStepResult {
  digger.pathProgress += cfg.carrySpeedFactor;
  if (digger.pathProgress < 1) return { dirty: null };
  digger.pathProgress -= 1;

  if (digger.breadcrumbIndex <= digger.backtrackTargetIndex) {
    digger.heading = digger.parentHeading;
    digger.preferredHeading = digger.parentPreferredHeading;
    digger.leanAngle = digger.parentLeanAngle;
    digger.breadcrumbs.length = digger.breadcrumbIndex + 1;
    digger.onSideBranch = false;
    digger.phase = 'digging';
    return { dirty: null };
  }
  digger.breadcrumbIndex--;
  const at = digger.breadcrumbs[digger.breadcrumbIndex];
  digger.x = at.x;
  digger.y = at.y;
  digger.heading = at.heading + Math.PI;
  return { dirty: null };
}

export function stepDigger(
  digger: Digger,
  world: World,
  mound: Mound,
  dt: number,
  cfg: DiggerConfig,
): DiggerStepResult {
  if (digger.phase === 'digging') return stepDigging(digger, world, dt, cfg);
  if (digger.phase === 'goingUp') return stepGoingUp(digger, mound, cfg);
  if (digger.phase === 'backtracking') return stepBacktracking(digger, cfg);
  if (digger.phase === 'returningToParent') return stepReturningToParent(digger, cfg);
  return stepGoingDown(digger, cfg);
}
