// Composes the world (sky, soil, surface, ants, brood) and fits it to the
// viewport. M1 uses a fixed static framing; the real spring-damped
// auto-framing camera (drag, zoom, easing) arrives in M4.
import { Application, Container } from 'pixi.js';
import { layout, world } from '../config';
import { createAnts, type AntSpec } from './ants';
import { createBroodCluster } from './brood';
import { createOverlay } from './overlay';
import { createSky, type Sky } from './sky';
import { createSoil } from './soil';
import { createSurface, type Surface } from './surface';

export interface Scene {
  resize(width: number, height: number): void;
  update(deltaSeconds: number): void;
  sky: Sky;
}

const WORLD_WIDTH = world.gridW * world.cellSize;

// Hand-placed to sit inside the hand-authored tunnel mask (tunnelMask.ts):
// chamber A (nursery) at texel (168, 36), chamber B (royal) at (240, 98),
// the entrance at (200, 0), and a point partway down the main shaft.
const ANTS: AntSpec[] = [
  { x: 960, y: 392, rotation: 0, queen: true },
  { x: 645, y: 148, rotation: 0 },
  { x: 840, y: 568, rotation: Math.PI / 2 },
  { x: 836, y: -4, rotation: 0, carryingPellet: true },
];
const BROOD_POSITION = { x: 672, y: 144 };

export function createScene(app: Application, seed: string): Scene {
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  const sky = createSky(seed);
  worldContainer.addChild(sky.container);

  const soil = createSoil(seed);
  worldContainer.addChild(soil.container);

  const surface: Surface = createSurface(seed);
  worldContainer.addChild(surface.container);

  worldContainer.addChild(createBroodCluster(seed, BROOD_POSITION.x, BROOD_POSITION.y));
  worldContainer.addChild(createAnts(ANTS));

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
    update(deltaSeconds: number): void {
      sky.update(deltaSeconds);
      surface.update(deltaSeconds);
    },
    sky,
  };
}
