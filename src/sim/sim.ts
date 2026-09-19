// Top-level simulation state and fixed-timestep step function (CLAUDE.md
// "Fixed timestep simulation"). Pure: no DOM, no Pixi, no wall-clock reads —
// the caller (src/app/) decides how real time maps to calls to `step`.
import { createDigger, stepDigger, type Digger, type DiggerStepResult } from './ants/digger';
import { digging as diggingConfig, world as worldConfig } from '../config';
import { createMound, type Mound } from './surface/mound';
import { createWorld, type World } from './world';

export interface DiggerPose {
  x: number;
  y: number;
  heading: number;
}

export interface Simulation {
  world: World;
  mound: Mound;
  digger: Digger;
  /** The digger's pose just before the most recent step, for the renderer
   * to interpolate from (CLAUDE.md "Fixed timestep... with render
   * interpolation"). */
  previousDiggerPose: DiggerPose;
}

export function createSimulation(seed: string): Simulation {
  const world = createWorld(seed, worldConfig.gridW, worldConfig.gridH, worldConfig.cellSize);
  const mound = createMound(worldConfig.gridW, worldConfig.cellSize);

  const startX = (world.entranceCol + 0.5) * world.cellSize;
  const startY = world.cellSize * 1.5;
  const digger = createDigger(seed, startX, startY, diggingConfig);

  return {
    world,
    mound,
    digger,
    previousDiggerPose: { x: digger.x, y: digger.y, heading: digger.heading },
  };
}

export function stepSimulation(sim: Simulation, dt: number): DiggerStepResult {
  sim.previousDiggerPose = { x: sim.digger.x, y: sim.digger.y, heading: sim.digger.heading };
  return stepDigger(sim.digger, sim.world, sim.mound, dt, diggingConfig);
}
