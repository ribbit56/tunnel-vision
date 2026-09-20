// Top-level simulation state and fixed-timestep step function (CLAUDE.md
// "Fixed timestep simulation"). Pure: no DOM, no Pixi, no wall-clock reads —
// the caller (src/app/) decides how real time maps to calls to `step`.
import type { SurpriseKind } from '../environment/surprises';
import type { WeatherPhase } from '../environment/weather';
import {
  ants as antsConfig,
  digging as diggingConfig,
  foraging as foragingConfig,
  lifecycle as lifecycleConfig,
  movement as movementConfig,
  planner as plannerConfig,
  queen as queenConfig,
  roles as rolesConfig,
  weather as weatherConfig,
  world as worldConfig,
} from '../config';
import { createQueen, createWorkerAnt, stepAnt, type Ant, type AntStepConfig, type AntStepContext } from './ants/digger';
import { hasLineOfSight, isOpenCell } from './ants/pathing';
import { computeSeparation } from './ants/steering';
import { createForaging, updateForaging, type Foraging } from './colony/foraging';
import { createLifecycle, rebalanceRoles, updateLifecycle, type Lifecycle } from './colony/lifecycle';
import { createPlanner, updatePlanner, type ColonyNeeds, type Planner } from './colony/planner';
import { createMound, type Mound } from './surface/mound';
import { entrancePosition, mergeDirty, recomputeDistanceField, updateMoisture, type DirtyRect, type World } from './world';
import { createWorld } from './world';

export interface AntPose {
  x: number;
  y: number;
  heading: number;
}

export interface Simulation {
  seed: string;
  world: World;
  mound: Mound;
  ants: Ant[];
  previousAntPoses: AntPose[];
  planner: Planner;
  lifecycle: Lifecycle;
  foraging: Foraging;
  /** Elapsed focused minutes, driving the pacing curve (SPEC section 2).
   * Only advances while `focusRunning` (CLAUDE.md "Two clocks") — a stub
   * clock (MILESTONES M5), toggled by the Start/Pause control or the dev
   * panel, rather than the real timestamp-driven one M6 adds. */
  focusMinutes: number;
  focusRunning: boolean;
  /** SPEC section 6: 0 full day, 1 full night. An environment (`realTime`)
   * value, set externally each frame by the caller (CLAUDE.md's app layer
   * computes it from wall-clock time — sim/ itself never reads a clock) —
   * mirrors how `focusRunning` is externally toggled rather than owned here. */
  nightFactor: number;
  /** SPEC section 6 "Rain": also an externally-set `realTime` value, set
   * each frame from `environment/weather.ts`'s seeded schedule the same way
   * `nightFactor` is — a pure function of seed and time, so it never needs
   * catching up after a hidden tab. */
  weatherPhase: WeatherPhase;
  /** 0..1, alongside `weatherPhase` — how hard it's raining right now. Drives
   * the soil moisture front below and the render-only rain visuals. */
  rainIntensity: number;
  /** SPEC: "once it rains, one worker may plug the entrance... and unplug it
   * after the rain ends." Tracked here (rather than inferred from an ant's
   * phase) since the plugging ant returns to idle right after finishing —
   * this is what the renderer actually checks to draw the plug. */
  entrancePlugged: boolean;
  /** SPEC section 6 "Small surprises": "surface ants pause as a beetle
   * passes." Another externally-set `realTime` value (see `nightFactor`) —
   * non-null only while a beetle is the active surprise. */
  surfaceSurpriseX: number | null;
  /** The currently-active surprise kind, if any — purely for the dev
   * stats readout; behavior only ever reads `surfaceSurpriseX` above. */
  activeSurprise: SurpriseKind | null;
  ticksSinceDistanceFieldUpdate: number;
  lastDistanceFieldGeneration: number;
  ticksSincePlannerEvaluation: number;
  /** Next index for a newly-created worker's RNG stream name — keeps every
   * worker's stream unique across the whole session, not just the founding
   * batch. */
  nextWorkerIndex: number;
}

export interface SimStepResult {
  dirty: DirtyRect | null;
}

// SPEC: "recomputed at most once per second when terrain changes" — the sim
// runs at a fixed 30Hz, so once per second is once every 30 ticks.
const DISTANCE_FIELD_RECOMPUTE_INTERVAL_TICKS = 30;

export function createSimulation(seed: string): Simulation {
  const world = createWorld(seed, worldConfig.gridW, worldConfig.gridH, worldConfig.cellSize);
  const mound = createMound(worldConfig.gridW, worldConfig.cellSize);
  const entrance = entrancePosition(world);

  const queenAnt = createQueen(seed, world, queenConfig, movementConfig);
  const ants: Ant[] = [queenAnt];

  const planner = createPlanner(seed, entrance.x, entrance.y, plannerConfig);
  const lifecycle = createLifecycle(seed);
  const foraging = createForaging(seed, foragingConfig);

  return {
    seed,
    world,
    mound,
    ants,
    previousAntPoses: ants.map((ant) => ({ x: ant.x, y: ant.y, heading: ant.heading })),
    planner,
    lifecycle,
    foraging,
    focusMinutes: 0,
    focusRunning: false,
    nightFactor: 0,
    weatherPhase: 'clear',
    rainIntensity: 0,
    entrancePlugged: false,
    surfaceSurpriseX: null,
    activeSurprise: null,
    ticksSinceDistanceFieldUpdate: 0,
    lastDistanceFieldGeneration: world.terrainGeneration,
    ticksSincePlannerEvaluation: plannerConfig.evaluationIntervalTicks, // evaluate on the very first running tick
    nextWorkerIndex: 0,
  };
}

const SCRIPTED_QUEEN_PHASES = new Set(['queenGliding', 'queenWalking', 'queenSettled']);

/** Gently pushes ants apart when they overlap (SPEC: "light separation so
 * ants don't overlap"), skipping any push that would land an ant in solid
 * ground rather than trying to route around it — separation is a cosmetic
 * nudge, not a second pathing system. A digging ant is never displaced by
 * it (though other ants still treat it as an obstacle to avoid): the brush
 * that carves each tunnel is centered on that ant's own continuous path, so
 * nudging it sideways between ticks could open a small gap wider than the
 * next tick's brush reaches back across, leaving an unreachable pocket. The
 * queen is excluded too while her founding sequence is scripted (gliding,
 * walking) or she's settled in place — a stray nudge would fight her own
 * choreographed position. */
function applySeparation(ants: Ant[], world: World): void {
  const offsets = computeSeparation(ants, movementConfig.separationRadius);
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    const offset = offsets[i];
    const isDigging = ant.phase === 'diggingShaft' || ant.phase === 'diggingChamber' || ant.phase === 'diggingConnector';
    if (isDigging || SCRIPTED_QUEEN_PHASES.has(ant.phase) || (offset.x === 0 && offset.y === 0)) continue;

    const nx = ant.x + offset.x * movementConfig.separationStrength;
    const ny = ant.y + offset.y * movementConfig.separationStrength;
    const cx = Math.floor(nx / world.cellSize);
    const cy = Math.floor(ny / world.cellSize);
    if (!isOpenCell(world, cx, cy)) continue;
    // The destination cell being open isn't enough by itself — a push can
    // still cross a thin wall between two nearby tunnels. Confirm the whole
    // nudge stays in open ground, not just where it lands.
    if (!hasLineOfSight(world, { x: ant.x, y: ant.y }, { x: nx, y: ny })) continue;

    ant.x = nx;
    ant.y = ny;
  }
}

export function stepSimulation(sim: Simulation, dt: number): SimStepResult {
  for (let i = 0; i < sim.ants.length; i++) {
    sim.previousAntPoses[i].x = sim.ants[i].x;
    sim.previousAntPoses[i].y = sim.ants[i].y;
    sim.previousAntPoses[i].heading = sim.ants[i].heading;
  }

  if (sim.focusRunning) sim.focusMinutes += dt / 60;

  const ctx: AntStepContext = {
    world: sim.world,
    mound: sim.mound,
    planner: sim.planner,
    lifecycle: sim.lifecycle,
    foraging: sim.foraging,
    focusRunning: sim.focusRunning,
    nightFactor: sim.nightFactor,
    surfaceSurpriseX: sim.surfaceSurpriseX,
  };
  const cfg: AntStepConfig = {
    digging: diggingConfig,
    movement: movementConfig,
    wander: antsConfig,
    planner: plannerConfig,
    queen: queenConfig,
  };

  let dirty: DirtyRect | null = null;
  for (const ant of sim.ants) {
    const result = stepAnt(ant, ctx, dt, cfg);
    dirty = mergeDirty(dirty, result.dirty);
    if (result.entrancePlugChange === 'plugged') sim.entrancePlugged = true;
    if (result.entrancePlugChange === 'unplugged') sim.entrancePlugged = false;
  }

  applySeparation(sim.ants, sim.world);

  // SPEC section 6 "Rain": the moisture front is a `realTime` effect (like
  // night factor) — it keeps rising and drying regardless of whether focus
  // is running, the same way rain doesn't pause for a break.
  updateMoisture(sim.world, sim.rainIntensity, dt, weatherConfig);

  sim.ticksSinceDistanceFieldUpdate++;
  if (
    sim.ticksSinceDistanceFieldUpdate >= DISTANCE_FIELD_RECOMPUTE_INTERVAL_TICKS &&
    sim.world.terrainGeneration !== sim.lastDistanceFieldGeneration
  ) {
    recomputeDistanceField(sim.world);
    sim.lastDistanceFieldGeneration = sim.world.terrainGeneration;
    sim.ticksSinceDistanceFieldUpdate = 0;
  }

  // Colony growth (planner, brood, roles, foraging) only advances while
  // focus is running (CLAUDE.md "Two clocks") — everything below this line
  // is skipped outright while paused, which is what makes resting actually
  // calm rather than just an ant-side visual.
  if (sim.focusRunning) {
    // Shared by the planner's need-driven chamber choice (SPEC section 4)
    // and role rebalancing below — both care about the same three "waiting
    // on somewhere to go" counts, just to decide different things with them.
    const pendingBrood = sim.lifecycle.brood.filter((b) => !b.inNursery && !b.claimedByNurse).length;
    const unclaimedFood = sim.foraging.food.filter((f) => !f.claimedByForager).length;
    const idleWorkers = sim.ants.filter((ant) => ant.role === 'idler').length;

    sim.ticksSincePlannerEvaluation++;
    if (sim.ticksSincePlannerEvaluation >= plannerConfig.evaluationIntervalTicks) {
      const needs: ColonyNeeds = { pendingBrood, pendingFood: unclaimedFood, granaryStored: sim.foraging.granaryStored, idleWorkers };
      updatePlanner(sim.planner, sim.world, sim.focusMinutes, sim.lifecycle.brood.length, needs, plannerConfig, diggingConfig.edgeMarginCells);
      sim.ticksSincePlannerEvaluation = 0;
    }

    const queenAnt = sim.ants.find((ant) => ant.role === 'queen');
    const queenSettled = queenAnt?.phase === 'queenSettled';
    const royalChamber = sim.planner.chambers.find((c) => c.type === 'royal');
    const entrance = entrancePosition(sim.world);
    const royalX = royalChamber ? royalChamber.x : entrance.x;
    const royalY = royalChamber ? royalChamber.y : entrance.y;
    const workerCount = sim.ants.length - (queenAnt ? 1 : 0);

    const { newWorkers } = updateLifecycle(
      sim.lifecycle,
      sim.focusMinutes,
      workerCount,
      queenSettled,
      royalX,
      royalY,
      lifecycleConfig,
      plannerConfig,
    );
    for (const worker of newWorkers) {
      const ant = createWorkerAnt(sim.seed, sim.nextWorkerIndex++, worker.x, worker.y, worker.nanitic, lifecycleConfig, movementConfig);
      sim.ants.push(ant);
      sim.previousAntPoses.push({ x: ant.x, y: ant.y, heading: ant.heading });
    }

    updateForaging(sim.foraging, sim.focusMinutes, entrance.x, foragingConfig);

    const hasNursery = sim.planner.chambers.some((c) => c.type === 'nursery');
    const hasGranary = sim.planner.chambers.some((c) => c.type === 'granary');
    // SPEC: "foragers head home when clouds arrive" — no new forage trips
    // start once weather turns; a forager already out simply finishes its
    // current trip rather than being yanked back mid-errand (the same
    // "ants finish their current small action" treatment the colony already
    // gives a focus pause elsewhere).
    const sheltering = sim.weatherPhase !== 'clear';
    rebalanceRoles(sim.ants, sim.focusMinutes, sim.lifecycle, hasNursery, hasGranary, pendingBrood, unclaimedFood, sim.nightFactor, sheltering, rolesConfig);

    // SPEC: "once it rains, one worker may plug the entrance with a pellet
    // and unplug it after the rain ends." A one-off job assigned straight to
    // an idle ant's phase (not through the role system above, since plugging
    // doesn't change what role that ant goes back to afterward) — retried
    // every tick until an idle ant happens to be available, since "may" is
    // opportunistic rather than guaranteed.
    const isHandlingEntrance = sim.ants.some((ant) => ant.phase === 'plugEntrance' || ant.phase === 'unplugEntrance');
    if (!isHandlingEntrance) {
      const wantsPlugged = sim.weatherPhase === 'rain';
      if (wantsPlugged !== sim.entrancePlugged) {
        // 'idle' itself is a one-tick transitional phase (an ant passes
        // through it only for the instant between being assigned a role and
        // `stepIdle` sending it off to wander or work) — an idler settles
        // into 'movingToTarget'/'pausing' for the long run, so those are the
        // phases that actually hold the "free right now" ants worth picking
        // from (the same three `rebalanceRoles` treats as reassignable).
        const freeWorker = sim.ants.find(
          (ant) => ant.role !== 'queen' && (ant.phase === 'idle' || ant.phase === 'movingToTarget' || ant.phase === 'pausing'),
        );
        if (freeWorker) freeWorker.phase = wantsPlugged ? 'plugEntrance' : 'unplugEntrance';
      }
    }
  }

  return { dirty };
}

/** Runs the sim forward by the given number of focused minutes in one go —
 * the dev/test-only `advanceFocus` from SPEC's debug API (MILESTONES M4).
 * Real time-scale playback (starting focus and waiting) reaches the exact
 * same state; this just does it synchronously, e.g. so a screenshot gallery
 * can render a "2-hour-equivalent" nest without actually waiting. Leaves
 * focus running afterward, same as if the user had actually started it. */
export function advanceFocus(sim: Simulation, minutes: number): void {
  sim.focusRunning = true;
  const FIXED_DT = 1 / 30;
  const ticks = Math.round((minutes * 60) / FIXED_DT);
  for (let i = 0; i < ticks; i++) stepSimulation(sim, FIXED_DT);
}
