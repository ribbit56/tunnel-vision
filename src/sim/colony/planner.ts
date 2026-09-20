// The colony planner (SPEC section 4): decides *what* to dig next — where a
// shaft should extend, when and where a chamber belongs, when two chambers
// should be linked. Ants (src/sim/ants/) decide *how*: the actual walking
// and carving. Keeping that split means the organic, hand-tuned digging
// motion from earlier milestones doesn't change at all here — this module
// only ever hands out a starting point and a general direction or shape, the
// same way a real colony's "urge to dig here" doesn't dictate an ant's exact
// footsteps.
//
// Chamber *type* is picked by real need (SPEC section 4): brood waiting on a
// nursery, food waiting on a granary, idle workers waiting on somewhere to
// rest, or — failing all three — simply `openCells` falling behind
// `targetOpenCells`. See `pickNextChamberType`.
import type { Rng } from '../rng';
import { createStream } from '../rng';
import { isDiggable, sampleHardness, totalVolumeDug, type World } from '../world';

export type ChamberType = 'royal' | 'nursery' | 'granary' | 'resting';

export interface Shaft {
  id: number;
  isMajor: boolean;
  /** Centerline recorded by the ant digging it, roughly every few world px
   * of travel (see `PlannerConfig.shaftPointSampleDistance`) — this is what
   * chamber placement samples candidate sites from, and what lets a shaft be
   * extended or branched from later without re-deriving its shape from the
   * density grid. */
  points: { x: number; y: number }[];
}

export interface Chamber {
  id: number;
  type: ChamberType;
  shaftId: number;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  /** Where the connector meets the shaft — chamber excavation works outward
   * from here (SPEC: "excavated from the connector side outward"). */
  connectorX: number;
  connectorY: number;
  /** Cell-units removed from this chamber's footprint so far, vs. `PlannerConfig`-
   * derived expected volume — used to tell when it's "done enough." */
  dugVolume: number;
  done: boolean;
}

export interface ShaftJob {
  kind: 'shaft';
  id: number;
  shaftId: number;
  fromX: number;
  fromY: number;
  heading: number;
  /** World px of net travel this segment should cover before the ant
   * reports back and the planner re-evaluates (SPEC's `ShaftSegment.length`). */
  targetLength: number;
}

export interface ChamberJob {
  kind: 'chamber';
  id: number;
  chamberId: number;
}

export interface ConnectorJob {
  kind: 'connector';
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export type DigJob = ShaftJob | ChamberJob | ConnectorJob;

export interface Planner {
  shafts: Shaft[];
  chambers: Chamber[];
  /** Unclaimed jobs, available for any idle ant to take (see `claimJob`). */
  jobs: DigJob[];
  majorShaftCount: number;
  nextShaftId: number;
  nextChamberId: number;
  nextJobId: number;
  /** Alternates which side of a shaft the next chamber buds off, per SPEC's
   * "prefers alternating sides." */
  nextChamberSide: 1 | -1;
  rng: Rng;
  ticksSinceEvaluation: number;
}

export interface PlannerConfig {
  evaluationIntervalTicks: number;
  cellsPerWorker: number;
  foundingCells: number;
  // Pacing curve (SPEC section 2) — see `targetWorkers`.
  foundingMinutes: number;
  curveSoftnessMinutes: number;
  matureMinutes: number;
  matureWorkers: number;
  capWorkers: number;

  shaftSegmentLengthMin: number;
  shaftSegmentLengthMax: number;
  initialShaftLeanRange: number;
  secondaryShaftLeanRange: number;
  shaftContinueDeflectionRange: number;
  maxMajorShafts: number;
  majorShaftChance: number;

  shaftPointSampleDistance: number;
  chamberSpacingVertical: number;
  chamberSpacingHorizontal: number;
  chamberSideOffsetSlack: number;
  candidateJitter: number;
  chamberAttemptChance: number;

  chamberRadiusXByType: Record<ChamberType, [number, number]>;
  chamberRadiusYByType: Record<ChamberType, [number, number]>;
  chamberBrushSpacing: number;

  connectorChancePerEvaluation: number;
  connectorMaxDistance: number;

  broodCapacityPerNurseryChamber: number;
  foodCapacityPerGranaryChamber: number;
  idleCapacityPerRestingChamber: number;
}

/** The three real, need-driven chamber triggers from SPEC section 4 (a
 * fourth — `openCells` behind `targetOpenCells` — is handled separately in
 * `updatePlanner`, since it's not about any one chamber type). Measured as
 * "not yet accounted for by an existing chamber of that type," the same way
 * nursery brood counts brood that hasn't reached a nursery yet rather than
 * literal occupancy — a colony with zero nurseries still has brood needing
 * one. `pendingFood` (still waiting on the surface, capped small) covers the
 * bootstrap case before any granary exists; `granaryStored` (food already
 * delivered, uncapped) is what keeps asking for more granary space as a long
 * session's hoard grows — granary need is the sum of both. */
export interface ColonyNeeds {
  pendingBrood: number;
  pendingFood: number;
  granaryStored: number;
  idleWorkers: number;
}

/** The direction a shaft has actually been heading lately, from its own
 * recorded centerline points — averaged over a short lookback rather than
 * just the last two points, since a single ant's own moment-to-moment
 * wander (SPEC's correlated random walk) would otherwise read as noisy. Used
 * to keep extending a shaft in roughly the direction it's already
 * committed to (see `updatePlanner`) instead of every continuation
 * re-centering on straight down — the earlier behavior made every shaft
 * wobble around vertical forever regardless of how far it had already
 * drifted, which is why a mature nest read as a tight vertical column
 * rather than the spread-out, organically branching shape SPEC's reference
 * images show. Falls back to straight down when a shaft is too new to have
 * an established direction yet. */
function shaftRecentHeading(shaft: Shaft): number {
  const pts = shaft.points;
  if (pts.length < 2) return Math.PI / 2;
  const lookback = Math.min(pts.length - 1, 20);
  const from = pts[pts.length - 1 - lookback];
  const to = pts[pts.length - 1];
  if (from.x === to.x && from.y === to.y) return Math.PI / 2;
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Blends two headings by their unit-vector components rather than
 * averaging the raw radian values, which would misbehave across the
 * -pi/pi wraparound — not actually reachable by the near-straight-down
 * headings this planner ever produces, but cheap to do correctly regardless.
 */
function blendHeadings(a: number, weightA: number, b: number, weightB: number): number {
  const x = Math.cos(a) * weightA + Math.cos(b) * weightB;
  const y = Math.sin(a) * weightA + Math.sin(b) * weightB;
  return Math.atan2(y, x);
}

/** How far (world px) from the undiggable edge margin still counts as
 * "close enough to play it safe" when picking a shaft continuation's
 * heading — a few shaft segments' worth of buffer (segments run 150-350px),
 * so there's room to actually turn back before really reaching the margin. */
const EDGE_AWARENESS_BUFFER = 250;

/** Even blending half toward vertical (see `blendHeadings` above the
 * continuation branch) wasn't enough on its own: a shaft repeatedly blocked
 * near the world's left/right edge keeps recording points that still show
 * it having been heading edgeward right up until each block, so a 50/50
 * blend could still average out edgeward more often than not, keeping a
 * shaft stuck bouncing along the margin for a very long time (confirmed by
 * the "ants stay within the world over a very long run" test — this
 * actually happening turns a normally-trivial test into a many-minutes
 * one). Explicitly falling back to the original, proven-safe "always
 * roughly vertical" heading whenever the shaft's last point is this close
 * to either edge sidesteps the feedback loop entirely rather than just
 * making it less likely. */
function nearHorizontalEdge(x: number, world: World, edgeMarginCells: number): boolean {
  const margin = edgeMarginCells * world.cellSize + EDGE_AWARENESS_BUFFER;
  return x < margin || x > world.gridW * world.cellSize - margin;
}

function createShaftJob(planner: Planner, shaftId: number, fromX: number, fromY: number, heading: number, cfg: PlannerConfig): ShaftJob {
  const targetLength = cfg.shaftSegmentLengthMin + planner.rng() * (cfg.shaftSegmentLengthMax - cfg.shaftSegmentLengthMin);
  return { kind: 'shaft', id: planner.nextJobId++, shaftId, fromX, fromY, heading, targetLength };
}

export function createPlanner(seed: string, startX: number, startY: number, cfg: PlannerConfig): Planner {
  const rng = createStream(seed, 'colony:planner');
  const planner: Planner = {
    shafts: [],
    chambers: [],
    jobs: [],
    majorShaftCount: 0,
    nextShaftId: 0,
    nextChamberId: 0,
    nextJobId: 0,
    nextChamberSide: rng() < 0.5 ? 1 : -1,
    rng,
    ticksSinceEvaluation: 0,
  };

  // SPEC: "one main shaft descending from the entrance, with gentle lean."
  const heading = Math.PI / 2 + (rng() - 0.5) * cfg.initialShaftLeanRange;
  const shaft: Shaft = { id: planner.nextShaftId++, isMajor: true, points: [{ x: startX, y: startY }] };
  planner.shafts.push(shaft);
  planner.majorShaftCount = 1;
  planner.jobs.push(createShaftJob(planner, shaft.id, startX, startY, heading, cfg));

  return planner;
}

/** SPEC section 2's pacing curve: fast at first, slowing logarithmically. A
 * *target*, not the real worker count — actual workers lag behind this
 * since brood takes time to mature (`sim/colony/lifecycle.ts`). */
export function targetWorkers(focusMinutes: number, cfg: PlannerConfig): number {
  const t = Math.max(0, focusMinutes - cfg.foundingMinutes);
  const span = cfg.matureMinutes - cfg.foundingMinutes;
  const raw = (cfg.matureWorkers * Math.log(1 + t / cfg.curveSoftnessMinutes)) / Math.log(1 + span / cfg.curveSoftnessMinutes);
  return Math.min(cfg.capWorkers, raw);
}

/** SPEC section 2: nest size tracks population (real ant nests scale their
 * volume with worker count) — `broodCount` counts double-weighted since
 * brood takes space too, just less than a full-grown worker. */
export function targetOpenCells(focusMinutes: number, broodCount: number, cfg: PlannerConfig): number {
  return cfg.foundingCells + cfg.cellsPerWorker * (targetWorkers(focusMinutes, cfg) + 0.5 * broodCount);
}

/** SPEC section 4: "a new chamber is requested when a need crosses a
 * threshold." Whichever of the three needs is furthest past what the
 * colony's existing chambers of that type can already hold wins — so the
 * order chambers appear in, and so the colony's overall shape, tracks each
 * seed's own pace of brood-laying, foraging, and worker growth instead of
 * cycling through a fixed rotation the same way every time.
 *
 * Returns null when none of the three needs actually crosses its threshold —
 * `openCells` can still be behind `targetOpenCells` (SPEC's fourth trigger)
 * with every real need satisfied, and that's just a cue to keep extending a
 * shaft (`updatePlanner`'s existing fallback), not to invent a chamber
 * nothing actually needs. Without this, whichever type's capacity is
 * cheapest to satisfy (resting has no depth-band limit at all) turns into a
 * generic filler and ends up wildly overbuilt over a long session. */
function pickNextChamberType(planner: Planner, needs: ColonyNeeds, cfg: PlannerConfig): ChamberType | null {
  const hasRoyal = planner.chambers.some((c) => c.type === 'royal');
  if (!hasRoyal) return 'royal';

  const countOf = (type: ChamberType) => planner.chambers.filter((c) => c.type === type).length;
  const candidates: { type: ChamberType; excess: number }[] = [
    { type: 'nursery', excess: needs.pendingBrood - countOf('nursery') * cfg.broodCapacityPerNurseryChamber },
    // "Stored food exceeds granary capacity" (SPEC) — pendingFood alone
    // covers the bootstrap case before any granary exists (a small, capped
    // backlog on the surface), and granaryStored (uncapped, only grows)
    // takes over as the real pressure once there's somewhere to deliver to.
    { type: 'granary', excess: needs.pendingFood + needs.granaryStored - countOf('granary') * cfg.foodCapacityPerGranaryChamber },
    { type: 'resting', excess: needs.idleWorkers - countOf('resting') * cfg.idleCapacityPerRestingChamber },
  ];
  candidates.sort((a, b) => b.excess - a.excess);
  const best = candidates[0];
  return best.excess > 0 ? best.type : null;
}

/** Depth as a fraction of the deepest point any shaft has reached so far —
 * SPEC's chamber placement is expressed relative to this ("25 to 40% of max
 * depth reached so far" for the royal chamber), not an absolute world depth,
 * so it scales naturally with however deep the nest actually is. */
function maxDepthReached(planner: Planner, startY: number): number {
  let maxY = startY;
  for (const shaft of planner.shafts) {
    for (const point of shaft.points) maxY = Math.max(maxY, point.y);
  }
  return Math.max(1, maxY - startY);
}

function depthBandFits(type: ChamberType, depthFraction: number): boolean {
  switch (type) {
    case 'royal':
      return depthFraction >= 0.2 && depthFraction <= 0.45;
    case 'nursery':
      return depthFraction <= 0.6;
    case 'granary':
      return depthFraction >= 0.35;
    case 'resting':
      return true;
  }
}

interface Candidate {
  shaftId: number;
  connectorX: number;
  connectorY: number;
  x: number;
  y: number;
  score: number;
}

/** Scores one candidate site (SPEC's placement rules). Returns null if the
 * site is disqualified outright (footprint doesn't fit, touches rock or the
 * edge margin, or sits too close to an existing chamber). */
function scoreCandidate(
  planner: Planner,
  world: World,
  type: ChamberType,
  shaft: Shaft,
  pointIndex: number,
  side: 1 | -1,
  radiusX: number,
  radiusY: number,
  cfg: PlannerConfig,
  edgeMarginCells: number,
): Candidate | null {
  const point = shaft.points[pointIndex];
  const prev = shaft.points[Math.max(0, pointIndex - 1)];
  const next = shaft.points[Math.min(shaft.points.length - 1, pointIndex + 1)];
  const dirX = next.x - prev.x;
  const dirY = next.y - prev.y;
  const len = Math.hypot(dirX, dirY) || 1;
  const perpX = (-dirY / len) * side;
  const perpY = (dirX / len) * side;

  const offset = radiusX + cfg.chamberSideOffsetSlack;
  const cx = point.x + perpX * offset;
  const cy = point.y + perpY * offset;

  const cellSize = world.cellSize;
  const marginCells = 2; // SPEC: "no rock within the chamber footprint plus margin"
  const cx0 = Math.floor((cx - radiusX) / cellSize) - marginCells;
  const cx1 = Math.ceil((cx + radiusX) / cellSize) + marginCells;
  const cy0 = Math.floor((cy - radiusY) / cellSize) - marginCells;
  const cy1 = Math.ceil((cy + radiusY) / cellSize) + marginCells;

  let hardnessSum = 0;
  let sampleCount = 0;
  for (let gy = cy0; gy <= cy1; gy++) {
    for (let gx = cx0; gx <= cx1; gx++) {
      if (!isDiggable(world, gx, gy, edgeMarginCells)) return null;
      const wx = (gx + 0.5) * cellSize;
      const wy = (gy + 0.5) * cellSize;
      const dist = Math.hypot((wx - cx) / radiusX, (wy - cy) / radiusY);
      if (dist > 1.15) continue;
      hardnessSum += sampleHardness(world, wx, wy);
      sampleCount++;
    }
  }
  if (sampleCount === 0) return null;

  for (const other of planner.chambers) {
    // Edge-to-edge, not center-to-center — SPEC's "minimum spacing... at
    // least 8 cells vertical, 6 horizontal clearance" means a gap between
    // the chambers themselves, and two chambers can each be up to 80 world
    // px across, far more than the clearance alone.
    const edgeDx = Math.abs(other.x - cx) - (other.radiusX + radiusX);
    const edgeDy = Math.abs(other.y - cy) - (other.radiusY + radiusY);
    if (edgeDy < cfg.chamberSpacingVertical && edgeDx < cfg.chamberSpacingHorizontal) return null;
  }

  const depthFraction = (cy - shaft.points[0].y) / maxDepthReached(planner, shaft.points[0].y);
  if (!depthBandFits(type, depthFraction)) return null;

  const avgHardness = hardnessSum / sampleCount;
  const softnessScore = 1 - avgHardness; // prefer softer soil
  const jitter = (planner.rng() - 0.5) * cfg.candidateJitter;
  const score = softnessScore + jitter;

  return { shaftId: shaft.id, connectorX: point.x, connectorY: point.y, x: cx, y: cy, score };
}

function tryPlaceChamber(planner: Planner, world: World, needs: ColonyNeeds, cfg: PlannerConfig, edgeMarginCells: number): boolean {
  const type = pickNextChamberType(planner, needs, cfg);
  if (!type) return false;
  const [radiusXMin, radiusXMax] = cfg.chamberRadiusXByType[type];
  const [radiusYMin, radiusYMax] = cfg.chamberRadiusYByType[type];
  const radiusX = radiusXMin + planner.rng() * (radiusXMax - radiusXMin);
  const radiusY = radiusYMin + planner.rng() * (radiusYMax - radiusYMin);

  let best: Candidate | null = null;
  for (const shaft of planner.shafts) {
    // Every few recorded points, not every single one — keeps candidate
    // scanning cheap on a long shaft, and chambers don't need to be able to
    // bud off literally every few world px anyway.
    for (let i = 0; i < shaft.points.length; i += 4) {
      const side = planner.nextChamberSide;
      const candidate = scoreCandidate(planner, world, type, shaft, i, side, radiusX, radiusY, cfg, edgeMarginCells);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }
  if (!best) return false;

  const chamber: Chamber = {
    id: planner.nextChamberId++,
    type,
    shaftId: best.shaftId,
    x: best.x,
    y: best.y,
    radiusX,
    radiusY,
    connectorX: best.connectorX,
    connectorY: best.connectorY,
    dugVolume: 0,
    done: false,
  };
  planner.chambers.push(chamber);
  // "Prefers alternating sides" (SPEC), not a strict rule — flipping every
  // single time reads as too mechanical, a perfect zigzag instead of an
  // organic scatter.
  if (planner.rng() < 0.75) planner.nextChamberSide = planner.nextChamberSide === 1 ? -1 : 1;

  // Unshifted to the front, not appended: SPEC frames the planner's output
  // as "a priority queue of dig jobs," and a chamber that was just placed —
  // especially the royal one, mandatory before the queen can settle — is
  // more urgent than a backlog of shaft-growth filler jobs queued earlier
  // while no candidate site existed yet. Appending here left the founding
  // sequence stalled digging pointless extra shaft length for minutes
  // before ever reaching the royal chamber job behind it in the queue.
  planner.jobs.unshift({ kind: 'chamber', id: planner.nextJobId++, chamberId: chamber.id });
  planner.jobs.unshift({
    kind: 'connector',
    id: planner.nextJobId++,
    fromX: best.connectorX,
    fromY: best.connectorY,
    toX: best.x,
    toY: best.y,
  });
  return true;
}

function tryPlaceConnector(planner: Planner, cfg: PlannerConfig): void {
  if (planner.rng() > cfg.connectorChancePerEvaluation) return;
  if (planner.chambers.length < 2) return;

  // Pick two chambers on *different* shafts within range — loops between
  // chambers on the same shaft would just retrace the shaft itself.
  for (let attempt = 0; attempt < 5; attempt++) {
    const a = planner.chambers[Math.floor(planner.rng() * planner.chambers.length)];
    const b = planner.chambers[Math.floor(planner.rng() * planner.chambers.length)];
    if (a === b || a.shaftId === b.shaftId) continue;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > cfg.connectorMaxDistance) continue;
    planner.jobs.push({ kind: 'connector', id: planner.nextJobId++, fromX: a.x, fromY: a.y, toX: b.x, toY: b.y });
    return;
  }
}

/** Re-evaluates the colony's needs and tops up the job queue. Cheap enough
 * to call often, but throttled the same way the distance field is — nothing
 * here needs tick-level freshness. */
export function updatePlanner(
  planner: Planner,
  world: World,
  focusMinutes: number,
  broodCount: number,
  needs: ColonyNeeds,
  cfg: PlannerConfig,
  edgeMarginCells: number,
): void {
  const openCells = totalVolumeDug(world);
  const needed = targetOpenCells(focusMinutes, broodCount, cfg);
  // The pacing curve's floor (`foundingCells`) covers the founding notch,
  // not the royal chamber the queen still has to dig to found the colony at
  // all — `targetWorkers` (and so `needed`) stays pinned at that floor for
  // the whole first `foundingMinutes`, which the queen's own founding dig
  // blows past almost immediately. Without this, the planner would decide
  // the colony already has "enough" open space and stop handing out any
  // work at all before she ever gets a royal chamber to settle in.
  const hasRoyal = planner.chambers.some((c) => c.type === 'royal');

  if (!hasRoyal || openCells < needed) {
    // Roughly one new avenue of work per evaluation while behind target.
    // Chambers are only *attempted* a fraction of the time, with shaft
    // growth otherwise preferred outright — trying one on essentially every
    // evaluation (whenever a legal site exists) let chambers saturate a
    // short stretch of shaft before it ever grew any further, packing them
    // at the tightest legal spacing in an unnaturally regular rhythm. Giving
    // the shaft more room to extend between chambers spreads them out
    // organically instead. That reasoning doesn't apply yet to the founding
    // royal chamber though — there's nothing to over-saturate before the
    // colony even has one chamber — so it's attempted every time until found.
    const attemptChamber = !hasRoyal || planner.rng() < cfg.chamberAttemptChance;
    if (!attemptChamber || !tryPlaceChamber(planner, world, needs, cfg, edgeMarginCells)) {
      // While still founding, don't pile another shaft-growth job on top of
      // one already queued — the queen only works one at a time regardless,
      // so a backlog here just delays how soon she reaches the royal
      // chamber once a valid site is finally found, without growing the
      // shaft any faster than working through one job at a time already does.
      const shaftJobAlreadyQueued = !hasRoyal && planner.jobs.some((job) => job.kind === 'shaft');
      if (!shaftJobAlreadyQueued) {
        const shaft = planner.shafts[Math.floor(planner.rng() * planner.shafts.length)];
        const last = shaft.points[shaft.points.length - 1];
        // SPEC: "as the colony grows, secondary shafts branch off..." —
        // gated on at least one chamber existing yet, so a session can't
        // promote a second major shaft in its first few seconds, before the
        // main shaft has even had room to grow a founding chamber.
        const canPromote =
          planner.chambers.length > 0 && planner.majorShaftCount < cfg.maxMajorShafts && planner.rng() < cfg.majorShaftChance;
        if (canPromote) {
          const newShaft: Shaft = { id: planner.nextShaftId++, isMajor: true, points: [{ x: last.x, y: last.y }] };
          planner.shafts.push(newShaft);
          planner.majorShaftCount++;
          const branchHeading = Math.PI / 2 + (planner.rng() - 0.5) * cfg.secondaryShaftLeanRange;
          planner.jobs.push(createShaftJob(planner, newShaft.id, last.x, last.y, branchHeading, cfg));
        } else {
          // Builds on the shaft's own recent direction (half-blended with
          // vertical, see `blendHeadings`) instead of fully re-centering on
          // straight down every time — this is what lets a shaft that's
          // already drifted sideways keep drifting, fanning the network out
          // instead of every branch settling back into the same narrow
          // vertical band around the entrance. Except near the world's
          // left/right edges, where `nearHorizontalEdge` falls back to the
          // original always-roughly-vertical heading instead — see its own
          // comment for why that edge case needs to be handled explicitly
          // rather than just trusting the blend.
          const heading = nearHorizontalEdge(last.x, world, edgeMarginCells)
            ? Math.PI / 2 + (planner.rng() - 0.5) * cfg.initialShaftLeanRange
            : blendHeadings(shaftRecentHeading(shaft), 0.5, Math.PI / 2, 0.5) + (planner.rng() - 0.5) * cfg.shaftContinueDeflectionRange;
          planner.jobs.push(createShaftJob(planner, shaft.id, last.x, last.y, heading, cfg));
        }
      }
    }
    tryPlaceConnector(planner, cfg);
  }
}

/** Hands an idle ant the next available job, if any. */
export function claimJob(planner: Planner): DigJob | null {
  return planner.jobs.shift() ?? null;
}

/**
 * A sweep order covering a chamber's elliptical footprint, nearest the
 * connector first (SPEC: "excavated from the connector side outward"). An
 * ant visiting these in order and digging its normal brush at each stop
 * opens the same soft, flattened-ellipse shape the earlier ad-hoc chamber
 * carving already produced — this only changes *where* the ant goes, not
 * how digging itself looks.
 */
export function chamberSweepPoints(chamber: Chamber, spacing: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let dy = -chamber.radiusY; dy <= chamber.radiusY; dy += spacing) {
    for (let dx = -chamber.radiusX; dx <= chamber.radiusX; dx += spacing) {
      if ((dx / chamber.radiusX) ** 2 + (dy / chamber.radiusY) ** 2 > 1) continue;
      points.push({ x: chamber.x + dx, y: chamber.y + dy });
    }
  }
  points.sort((a, b) => {
    const da = Math.hypot(a.x - chamber.connectorX, a.y - chamber.connectorY);
    const db = Math.hypot(b.x - chamber.connectorX, b.y - chamber.connectorY);
    return da - db;
  });
  return points;
}

/** Records a point along a shaft's centerline as an ant digs it (see
 * `Shaft.points`), sampled roughly every `shaftPointSampleDistance` of
 * travel by the caller. */
export function recordShaftPoint(planner: Planner, shaftId: number, x: number, y: number): void {
  const shaft = planner.shafts.find((s) => s.id === shaftId);
  if (shaft) shaft.points.push({ x, y });
}
