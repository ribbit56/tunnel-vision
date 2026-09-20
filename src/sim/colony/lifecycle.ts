// The colony's population (SPEC section 2 "Founding timeline", section 5
// "Roles"): brood maturing from egg to larva to pupa to worker, and which
// job each worker spends its time on. Growth here only ever advances while
// focus is running (CLAUDE.md "Two clocks") — the caller (`sim/sim.ts`)
// simply doesn't call `updateLifecycle` while paused, the same way it
// throttles the planner and distance field, so nothing here needs its own
// pause-awareness.
import type { Ant, AntRole } from '../ants/digger';
import type { Rng } from '../rng';
import { createStream } from '../rng';
import { targetWorkers, type PlannerConfig } from './planner';

export type BroodStage = 'egg' | 'larva' | 'pupa';

export interface BroodItem {
  id: number;
  stage: BroodStage;
  /** Focus-minute timestamp the current stage began, so maturing is just
   * "has enough focused time passed," not a tick counter to keep in sync. */
  stageStartMinutes: number;
  x: number;
  y: number;
  /** True once a nurse has carried it from the royal chamber to the
   * nursery. Brood laid before a nursery exists just waits in the royal
   * chamber — still maturing, just not sorted yet. */
  inNursery: boolean;
  claimedByNurse: boolean;
}

export interface LifecycleConfig {
  eggStageMinutes: number;
  larvaStageMinutes: number;
  pupaStageMinutes: number;
  eggCheckIntervalMinutes: number;
  naniticCount: number;
  naniticSizeScale: number;
}

export interface RolesConfig {
  rebalanceIntervalMinutes: number;
  diggerFraction: number;
  maxNurses: number;
  maxForagers: number;
  nightForagerFactor: number;
  nightDiggerFactor: number;
}

export interface Lifecycle {
  brood: BroodItem[];
  nextBroodId: number;
  workersEverCreated: number;
  nextEggCheckMinutes: number;
  nextRoleRebalanceMinutes: number;
  rng: Rng;
}

export function createLifecycle(seed: string): Lifecycle {
  return {
    brood: [],
    nextBroodId: 0,
    workersEverCreated: 0,
    nextEggCheckMinutes: 0,
    nextRoleRebalanceMinutes: 0,
    rng: createStream(seed, 'colony:lifecycle'),
  };
}

const STAGE_ORDER: BroodStage[] = ['egg', 'larva', 'pupa'];

function stageDuration(stage: BroodStage, cfg: LifecycleConfig): number {
  if (stage === 'egg') return cfg.eggStageMinutes;
  if (stage === 'larva') return cfg.larvaStageMinutes;
  return cfg.pupaStageMinutes;
}

export interface LifecycleStepResult {
  /** Where each newly matured worker should appear, and whether it's a
   * nanitic (SPEC: "first small workers, 80% size") — `sim.ts` is the one
   * that actually constructs the `Ant`, since that's ant-module territory. */
  newWorkers: { x: number; y: number; nanitic: boolean }[];
}

/**
 * Advances brood maturation and, once the queen has settled, lays new eggs
 * to close the gap toward `targetWorkers` (SPEC: "egg laying rate is driven
 * by the gap between targetWorkers and (workers + brood)"). Only called
 * while focus is running.
 */
export function updateLifecycle(
  lifecycle: Lifecycle,
  focusMinutes: number,
  currentWorkerCount: number,
  queenSettled: boolean,
  royalChamberX: number,
  royalChamberY: number,
  lifecycleCfg: LifecycleConfig,
  plannerCfg: PlannerConfig,
): LifecycleStepResult {
  const newWorkers: { x: number; y: number; nanitic: boolean }[] = [];

  for (const item of lifecycle.brood) {
    const duration = stageDuration(item.stage, lifecycleCfg);
    if (focusMinutes - item.stageStartMinutes < duration) continue;

    const stageIndex = STAGE_ORDER.indexOf(item.stage);
    if (stageIndex < STAGE_ORDER.length - 1) {
      item.stage = STAGE_ORDER[stageIndex + 1];
      item.stageStartMinutes = focusMinutes;
    } else {
      // A pupa maturing into a worker — SPEC: nanitics (80% size) for the
      // first few, since a founding colony's earliest workers really are
      // undersized in real ant nests.
      const nanitic = lifecycle.workersEverCreated < lifecycleCfg.naniticCount;
      lifecycle.workersEverCreated++;
      newWorkers.push({ x: item.x, y: item.y, nanitic });
      item.stage = '__done__' as BroodStage; // marked for removal below
    }
  }
  lifecycle.brood = lifecycle.brood.filter((item) => (item.stage as string) !== '__done__');

  if (queenSettled && focusMinutes >= lifecycle.nextEggCheckMinutes) {
    lifecycle.nextEggCheckMinutes = focusMinutes + lifecycleCfg.eggCheckIntervalMinutes;
    const gap = targetWorkers(focusMinutes, plannerCfg) - (currentWorkerCount + lifecycle.brood.length);
    if (gap > 0) {
      lifecycle.brood.push({
        id: lifecycle.nextBroodId++,
        stage: 'egg',
        stageStartMinutes: focusMinutes,
        x: royalChamberX,
        y: royalChamberY,
        inNursery: false,
        claimedByNurse: false,
      });
    }
  }

  return { newWorkers };
}

/**
 * Recomputes each worker's role from colony needs (SPEC: "role mix is
 * recomputed every few seconds"). Only reassigns ants that are between
 * actions (idling or wandering) — one mid-dig is left to finish its current
 * job rather than abruptly abandoning it, matching SPEC's own "ants finish
 * their current small action" phrasing for the pause case, applied here for
 * the same reason: a role change shouldn't read as an ant flinching.
 */
export function rebalanceRoles(
  ants: Ant[],
  focusMinutes: number,
  lifecycle: Lifecycle,
  hasNursery: boolean,
  hasGranary: boolean,
  pendingBroodToMove: number,
  unclaimedFoodCount: number,
  nightFactor: number,
  sheltering: boolean,
  cfg: RolesConfig,
): void {
  if (focusMinutes < lifecycle.nextRoleRebalanceMinutes) return;
  lifecycle.nextRoleRebalanceMinutes = focusMinutes + cfg.rebalanceIntervalMinutes;

  // SPEC section 6: "...fewer foragers, more resting" at night — nurses are
  // left alone (brood care doesn't pause for the night), but the digger
  // fraction and forager cap both ease down, blended smoothly by night
  // factor so nothing about the role mix visibly snaps at dusk/dawn.
  const nightDiggerFraction = cfg.diggerFraction * (1 - nightFactor * (1 - cfg.nightDiggerFactor));
  const nightMaxForagers = cfg.maxForagers * (1 - nightFactor * (1 - cfg.nightForagerFactor));

  const workers = ants.filter((ant) => ant.role !== 'queen');
  const diggerTarget = Math.max(workers.length > 0 ? 1 : 0, Math.round(workers.length * nightDiggerFraction));
  const nurseTarget = hasNursery ? Math.min(cfg.maxNurses, pendingBroodToMove) : 0;
  // SPEC section 6 "Rain": "foragers head home when clouds arrive" — a hard
  // cutoff (unlike night's gradual easing) since weather changes are the
  // more sudden of the two environment shifts.
  const forageTarget = hasGranary && !sheltering ? Math.min(Math.round(nightMaxForagers), unclaimedFoodCount + 1) : 0;

  const counts: Record<AntRole, number> = { queen: 0, digger: 0, nurse: 0, forager: 0, idler: 0 };
  for (const ant of workers) counts[ant.role]++;

  // Only ants that are free to reassign right now (idling/wandering, not
  // mid-job) are candidates — shuffled with the lifecycle's own RNG stream
  // so which ants switch isn't always the same handful in array order.
  const reassignable = workers.filter(
    (ant) => ant.phase === 'idle' || ant.phase === 'movingToTarget' || ant.phase === 'pausing',
  );
  for (let i = reassignable.length - 1; i > 0; i--) {
    const j = Math.floor(lifecycle.rng() * (i + 1));
    [reassignable[i], reassignable[j]] = [reassignable[j], reassignable[i]];
  }

  // Ants already reassigned earlier in this same call are off the table for
  // a later role — otherwise moving toward "nurse" could immediately steal
  // back an ant "digger" only just claimed a moment ago in the same pass.
  const reassignedThisCall = new Set<Ant>();

  function moveToward(role: AntRole, target: number): void {
    for (const ant of reassignable) {
      if (counts[role] >= target) return;
      if (ant.role === role || reassignedThisCall.has(ant)) continue;
      counts[ant.role]--;
      ant.role = role;
      ant.phase = 'idle';
      counts[role]++;
      reassignedThisCall.add(ant);
    }
  }

  // Digging is the priority job (it's what actually grows the nest), then
  // nursing and foraging split whatever's left; anyone not needed for those
  // just idles, which is most of the colony most of the time (SPEC).
  moveToward('digger', diggerTarget);
  moveToward('nurse', nurseTarget);
  moveToward('forager', forageTarget);
}
