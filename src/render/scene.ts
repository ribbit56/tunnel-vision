// Composes the world (sky, soil, surface, mound, the ants) and fits it to
// the viewport with the auto-framing camera (SPEC section 7 "Camera",
// `render/camera.ts`), which eases to keep the whole nest in view as it
// deepens and lets the user drag/scroll to override it by hand.
import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { layout, world as worldConfig } from '../config';
import { nightFactorForHour } from '../environment/dayNight';
import type { SurpriseState } from '../environment/surprises';
import type { WeatherState } from '../environment/weather';
import { FORAGER_SURFACE_Y } from '../sim/ants/digger';
import type { Simulation } from '../sim/sim';
import type { DirtyRect, World } from '../sim/world';
import { createAntSprite, type AntSprite } from './ants';
import { createCamera } from './camera';
import { createMoundRenderer } from './mound';
import { createOverlay } from './overlay';
import { createSky } from './sky';
import { createSoil } from './soil';
import { createSurface, type Surface } from './surface';
import { createSurpriseRenderer } from './surprises';
import { createWeatherRenderer } from './weather';
import { creatures, devOverlay, globalTreatment, sampleTimeOfDay } from '../theme/palette';

export interface Scene {
  resize(width: number, height: number): void;
  /** Cosmetic, real-time motion (sky, grass sway) — independent of the sim's
   * fixed timestep and dev time scale (CLAUDE.md "Two clocks"). */
  updateEnvironment(deltaSeconds: number): void;
  /** Advances the auto-framing camera and applies its transform. Also
   * real-time, for the same reason as `updateEnvironment`. */
  updateCamera(sim: Simulation, deltaSeconds: number): void;
  /** Repaints whatever the sim touched since the last render frame. */
  syncFromSim(sim: Simulation, dirty: DirtyRect | null): void;
  /** Draws every ant at its interpolated pose between sim ticks, and
   * advances leg-gait animation by this frame's real elapsed seconds. */
  renderInterpolated(sim: Simulation, alpha: number, deltaSeconds: number): void;
  /** Dev-mode density overlay (SPEC section 11): shows the raw tunnel mask
   * (white = open) directly, before the shader's soft edges and colors. */
  setDensityOverlayVisible(visible: boolean): void;
  /** Dev-mode overlay (SPEC section 11): chamber footprints and queued dig
   * jobs from the colony planner. */
  setPlannerOverlayVisible(visible: boolean): void;
  /** CLAUDE.md "Respect prefers-reduced-motion" — forwards to every
   * rendering system that has its own reduced-motion behavior. */
  setReducedMotion(reduced: boolean): void;
  /** SPEC section 6: sets the sky's own gradient/arcs and the "scene light"
   * tint/exposure applied to everything at or below the grass line (the sky
   * already gets its own dedicated colors, so it's excluded from the
   * second part). */
  setTimeOfDay(hours: number): void;
  /** SPEC section 6 "Rain": clouds, rain streaks, splashes, puddles, and
   * post-rain mushrooms, driven by `environment/weather.ts`'s schedule. */
  setWeather(state: WeatherState): void;
  /** SPEC section 6 "Small surprises": the currently-active occasional
   * creature/moment, driven by `environment/surprises.ts`'s schedule. */
  setSurprise(state: SurpriseState): void;
  /** SPEC section 11 dev trigger for root growth (SPEC's "Continuous"
   * surprise — see `SurpriseRenderer.fastForwardRoots`). */
  fastForwardRoots(seconds: number): void;
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

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
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

  const broodAndFoodLayer = new Graphics();
  worldContainer.addChild(broodAndFoodLayer);

  const antContainer = new Container();
  worldContainer.addChild(antContainer);
  // Pool grows lazily to match `sim.ants.length` the first time it's seen —
  // keeps this module from needing to know the ant count (or which are the
  // queen/nanitics) up front.
  const antSprites: AntSprite[] = [];

  const surprises = createSurpriseRenderer(seed);
  worldContainer.addChild(surprises.container);

  // SPEC section 6 "scene light": tints and dims everything at or below the
  // grass line as time of day changes — the sky above it already has its
  // own dedicated gradient, so this covers only y >= 0. Two separate fills
  // (`exposureLayer` for brightness, `tintLayer` for color mood) rather than
  // one, so a strong exposure dip can never compound with the tint into
  // "too dark" — see `globalTreatment.timeOfDayTintAlpha`.
  const worldDepth = world.gridH * world.cellSize;
  const exposureLayer = new Graphics();
  exposureLayer.blendMode = 'multiply';
  const tintLayer = new Graphics();
  tintLayer.blendMode = 'multiply';
  worldContainer.addChild(exposureLayer, tintLayer);

  const densityOverlay = new Sprite(soil.mask.texture);
  densityOverlay.width = WORLD_WIDTH;
  densityOverlay.height = worldConfig.gridH * worldConfig.cellSize;
  densityOverlay.alpha = 0.6;
  densityOverlay.visible = false;
  worldContainer.addChild(densityOverlay);

  const plannerOverlay = new Graphics();
  plannerOverlay.visible = false;
  worldContainer.addChild(plannerOverlay);

  // Added last so rain, cloud cover, and the wet-soil tint sit in front of
  // everything else in world space (ants included) — rain falls in front of
  // the scene, not behind it.
  const weather = createWeatherRenderer(seed);
  worldContainer.addChild(weather.container);

  const overlay = createOverlay();
  app.stage.addChild(overlay.container, overlay.vignette);

  const camera = createCamera();
  const entranceX = (world.entranceCol + 0.5) * world.cellSize;
  let viewportWidth = app.screen.width;
  let viewportHeight = app.screen.height;
  // Cached from the last setTimeOfDay call so updateEnvironment's per-frame
  // cosmetic updates (fireflies) can read it without main.ts needing to
  // pass it twice.
  let nightFactor = 0;

  function applyCameraTransform(): void {
    worldContainer.scale.set(camera.scale);
    worldContainer.x = viewportWidth / 2 - camera.centerX * camera.scale;
    worldContainer.y = viewportHeight * layout.skyFraction - camera.centerYOffset * camera.scale;
  }

  // SPEC: "the user can drag to pan and scroll to zoom." Pixi's canvas is a
  // real DOM element, so plain pointer/wheel listeners are enough — no need
  // to route this through Pixi's own (heavier) interaction system for two
  // simple gestures.
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  });
  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    camera.drag(e.clientX - lastPointerX, e.clientY - lastPointerY);
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    applyCameraTransform();
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  app.canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      camera.zoom(-e.deltaY * 0.001);
      applyCameraTransform();
    },
    { passive: false },
  );

  function resize(width: number, height: number): void {
    viewportWidth = width;
    viewportHeight = height;
    applyCameraTransform();
    overlay.resize(width, height);
  }

  function setTimeOfDay(hours: number): void {
    sky.setHour(hours);
    nightFactor = nightFactorForHour(hours);

    const { exposure, lightTint } = sampleTimeOfDay(hours);
    // Covers the same widened backdrop `render/soil.ts` draws (see its own
    // comment) so the decorative overscan margin dims/tints for time of day
    // exactly like the functional soil does, instead of staying at full
    // brightness as a visible "halo" around it.
    const dimLeft = -worldConfig.backgroundMargin;
    const dimWidth = WORLD_WIDTH + worldConfig.backgroundMargin * 2;
    exposureLayer.clear().rect(dimLeft, 0, dimWidth, worldDepth).fill({ color: 0x000000, alpha: 1 - exposure });
    tintLayer.clear().rect(dimLeft, 0, dimWidth, worldDepth).fill({ color: lightTint, alpha: globalTreatment.timeOfDayTintAlpha });
  }

  resize(app.screen.width, app.screen.height);
  setTimeOfDay(12); // matches sky's own default noon until the first real environment tick

  return {
    resize,
    setTimeOfDay,
    setWeather(state: WeatherState): void {
      weather.setWeather(state);
    },
    setSurprise(state: SurpriseState): void {
      surprises.setState(state);
    },
    fastForwardRoots(seconds: number): void {
      surprises.fastForwardRoots(seconds);
    },
    updateEnvironment(deltaSeconds: number): void {
      sky.update(deltaSeconds);
      surface.update(deltaSeconds, nightFactor);
      weather.update(deltaSeconds);
      surprises.update(deltaSeconds, nightFactor);
    },
    updateCamera(sim: Simulation, deltaSeconds: number): void {
      camera.update(deltaSeconds, sim.planner, entranceX, viewportWidth, viewportHeight);
      applyCameraTransform();
    },
    syncFromSim(sim: Simulation, dirty: DirtyRect | null): void {
      soil.mask.sync(dirty);
      moundRenderer.sync(sim.mound);
      surface.setEntrancePlugged(sim.entrancePlugged);

      if (plannerOverlay.visible) {
        plannerOverlay.clear();
        for (const chamber of sim.planner.chambers) {
          plannerOverlay
            .ellipse(chamber.x, chamber.y, chamber.radiusX, chamber.radiusY)
            .stroke({ width: 1.5, color: hex(devOverlay.chamberOutlineByType[chamber.type]), alpha: 0.9 });
        }
        for (const job of sim.planner.jobs) {
          if (job.kind === 'shaft') {
            const toX = job.fromX + Math.cos(job.heading) * 20;
            const toY = job.fromY + Math.sin(job.heading) * 20;
            plannerOverlay
              .moveTo(job.fromX, job.fromY)
              .lineTo(toX, toY)
              .stroke({ width: 2, color: hex(devOverlay.shaftJob), alpha: 0.9 });
          } else if (job.kind === 'connector') {
            plannerOverlay
              .moveTo(job.fromX, job.fromY)
              .lineTo(job.toX, job.toY)
              .stroke({ width: 1.5, color: hex(devOverlay.connectorJob), alpha: 0.7 });
          }
        }
      }
    },
    renderInterpolated(sim: Simulation, alpha: number, deltaSeconds: number): void {
      while (antSprites.length < sim.ants.length) {
        const ant = sim.ants[antSprites.length];
        const sprite = createAntSprite(ant.role === 'queen', ant.sizeScale);
        antSprites.push(sprite);
        antContainer.addChild(sprite.container);
      }

      for (let i = 0; i < sim.ants.length; i++) {
        const prev = sim.previousAntPoses[i];
        const cur = sim.ants[i];
        const sprite = antSprites[i];
        sprite.setPose(
          lerp(prev.x, cur.x, alpha),
          lerp(prev.y, cur.y, alpha),
          lerpAngle(prev.heading, cur.heading, alpha),
          cur.carryingItem,
        );
        sprite.updateGait(cur.currentSpeed, deltaSeconds);
        sprite.setWingsAlpha(cur.wingsAlpha);
      }

      broodAndFoodLayer.clear();
      for (const item of sim.lifecycle.brood) {
        const color =
          item.stage === 'egg' ? creatures.egg : item.stage === 'larva' ? creatures.larva : creatures.pupa;
        broodAndFoodLayer.ellipse(item.x, item.y, 2.6, 1.8).fill({ color: hex(color) });
      }
      for (const item of sim.foraging.food) {
        const color = item.kind === 'seed' ? creatures.seed : creatures.crumb;
        broodAndFoodLayer.circle(item.x, FORAGER_SURFACE_Y, 1.8).fill({ color: hex(color) });
      }
    },
    setDensityOverlayVisible(visible: boolean): void {
      densityOverlay.visible = visible;
    },
    setPlannerOverlayVisible(visible: boolean): void {
      plannerOverlay.visible = visible;
    },
    setReducedMotion(reduced: boolean): void {
      sky.setReducedMotion(reduced);
      surface.setReducedMotion(reduced);
      camera.setReducedMotion(reduced);
      weather.setReducedMotion(reduced);
      surprises.setReducedMotion(reduced);
    },
  };
}
