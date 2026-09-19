// Composes the world (sky, soil, surface, mound, the digger) and fits it to
// the viewport. M1's fixed static framing is still a stand-in for the real
// spring-damped auto-framing camera, which arrives in M4.
import { Application, Container, Sprite } from 'pixi.js';
import { layout, world as worldConfig } from '../config';
import type { Simulation } from '../sim/sim';
import type { DirtyRect, World } from '../sim/world';
import { createDiggerSprite } from './ants';
import { createMoundRenderer } from './mound';
import { createOverlay } from './overlay';
import { createSky, type Sky } from './sky';
import { createSoil } from './soil';
import { createSurface, type Surface } from './surface';

export interface Scene {
  resize(width: number, height: number): void;
  /** Cosmetic, real-time motion (sky, grass sway) — independent of the sim's
   * fixed timestep and dev time scale (CLAUDE.md "Two clocks"). */
  updateEnvironment(deltaSeconds: number): void;
  /** Repaints whatever the sim touched since the last render frame. */
  syncFromSim(sim: Simulation, dirty: DirtyRect | null): void;
  /** Draws the digger at its interpolated pose between sim ticks. */
  renderInterpolated(sim: Simulation, alpha: number): void;
  /** Dev-mode density overlay (SPEC section 11): shows the raw tunnel mask
   * (white = open) directly, before the shader's soft edges and colors. */
  setDensityOverlayVisible(visible: boolean): void;
  sky: Sky;
}

const WORLD_WIDTH = worldConfig.gridW * worldConfig.cellSize;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function createScene(app: Application, seed: string, world: World): Scene {
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const sky = createSky(seed);
  worldContainer.addChild(sky.container);

  const soil = createSoil(seed, world);
  worldContainer.addChild(soil.container);

  const surface: Surface = createSurface(seed);
  worldContainer.addChild(surface.container);

  const moundRenderer = createMoundRenderer();
  worldContainer.addChild(moundRenderer.container);

  const digger = createDiggerSprite();
  worldContainer.addChild(digger.container);

  const densityOverlay = new Sprite(soil.mask.texture);
  densityOverlay.width = WORLD_WIDTH;
  densityOverlay.height = worldConfig.gridH * worldConfig.cellSize;
  densityOverlay.alpha = 0.6;
  densityOverlay.visible = false;
  worldContainer.addChild(densityOverlay);

  const overlay = createOverlay();
  app.stage.addChild(overlay.container, overlay.vignette);

  function resize(width: number, height: number): void {
    // "Cover" fit: use whichever scale is larger so the scene always fills
    // the viewport, cropping left/right on a tall/narrow window rather than
    // leaving empty space above and below it (SPEC's real spring camera,
    // which frames the whole nest instead of cropping, arrives in M4).
    const scale = Math.max(width / WORLD_WIDTH, height / layout.minVisibleWorldHeight);
    worldContainer.scale.set(scale);
    worldContainer.x = width / 2 - layout.cameraCenterX * scale;
    worldContainer.y = height * layout.skyFraction;
    overlay.resize(width, height);
  }

  resize(app.screen.width, app.screen.height);

  return {
    resize,
    updateEnvironment(deltaSeconds: number): void {
      sky.update(deltaSeconds);
      surface.update(deltaSeconds);
    },
    syncFromSim(sim: Simulation, dirty: DirtyRect | null): void {
      soil.mask.sync(dirty);
      moundRenderer.sync(sim.mound);
    },
    renderInterpolated(sim: Simulation, alpha: number): void {
      const prev = sim.previousDiggerPose;
      const cur = sim.digger;
      digger.setPose(
        lerp(prev.x, cur.x, alpha),
        lerp(prev.y, cur.y, alpha),
        lerpAngle(prev.heading, cur.heading, alpha),
        cur.phase === 'goingUp',
      );
    },
    setDensityOverlayVisible(visible: boolean): void {
      densityOverlay.visible = visible;
    },
    sky,
  };
}
