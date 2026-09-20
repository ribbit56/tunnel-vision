// Small surprises (SPEC section 6): occasional cosmetic creatures/moments,
// one Graphics per kind rather than a pooled-per-occurrence system, since
// `environment/surprises.ts` only ever has one active at a time — a kind's
// shape is simply repositioned and shown/hidden as its own occurrences
// start and end. Root growth is the one exception (SPEC's "Continuous"
// entry): always visible, growing slowly with elapsed real session time
// rather than reacting to `SurpriseState` at all.
import { Container, Graphics } from 'pixi.js';
import { surprises as surprisesConfig, world as worldConfig } from '../config';
import { surfaceWalkerX, type SurpriseState } from '../environment/surprises';
import { createStream, type Rng } from '../sim/rng';
import { surprises as palette } from '../theme/palette';

export interface SurpriseRenderer {
  container: Container;
  setState(state: SurpriseState): void;
  update(deltaSeconds: number, nightFactor: number): void;
  setReducedMotion(reduced: boolean): void;
  /** SPEC section 11 "trigger any surprise" — root growth (the one
   * "Continuous" entry, so it isn't part of `SurpriseState`'s rotation) gets
   * its own dev-only way to preview a normally hours-long change: jump its
   * growth clock forward directly rather than waiting for real time. */
  fastForwardRoots(seconds: number): void;
}

const WORLD_WIDTH = worldConfig.gridW * worldConfig.cellSize;
const SURFACE_Y = -3; // matches ants/digger.ts's FORAGER_SURFACE_Y

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function buildBeetle(): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.ellipse(0, 0, 5, 3.2).fill({ color: hex(palette.beetle) });
  gfx.ellipse(-1, -0.5, 3, 2).fill({ color: hex(palette.beetleShell), alpha: 0.7 });
  container.addChild(gfx);
  return container;
}

function buildSnail(): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.ellipse(0, 0.5, 4, 2).fill({ color: hex(palette.snail) });
  gfx.circle(-1.5, -1.5, 3).fill({ color: hex(palette.snailShell) });
  container.addChild(gfx);
  return container;
}

function buildButterfly(): Container {
  const container = new Container();
  const gfx = new Graphics();
  gfx.ellipse(-2.2, 0, 2.6, 3.4).fill({ color: hex(palette.butterfly) });
  gfx.ellipse(2.2, 0, 2.6, 3.4).fill({ color: hex(palette.butterfly) });
  gfx.circle(-2.2, 0, 1).fill({ color: hex(palette.butterflyAccent), alpha: 0.8 });
  gfx.circle(2.2, 0, 1).fill({ color: hex(palette.butterflyAccent), alpha: 0.8 });
  container.addChild(gfx);
  return container;
}

function buildLeaf(): Graphics {
  const gfx = new Graphics();
  gfx.ellipse(0, 0, 4, 2.4).fill({ color: hex(palette.leaf) });
  return gfx;
}

export function createSurpriseRenderer(seed: string): SurpriseRenderer {
  const container = new Container();

  const earthwormGfx = new Graphics();
  earthwormGfx.visible = false;
  container.addChild(earthwormGfx);

  const beetle = buildBeetle();
  beetle.visible = false;
  container.addChild(beetle);

  const snail = buildSnail();
  snail.visible = false;
  container.addChild(snail);

  const butterfly = buildButterfly();
  butterfly.visible = false;
  container.addChild(butterfly);

  const leaf = buildLeaf();
  leaf.visible = false;
  container.addChild(leaf);

  const fireflyRng = createStream(seed, 'render:surprise:fireflies');
  const fireflyLayer = new Container();
  fireflyLayer.visible = false;
  container.addChild(fireflyLayer);
  const fireflyDots: { gfx: Graphics; homeX: number; homeY: number; phase: number }[] = [];
  for (let i = 0; i < surprisesConfig.extraFirefliesCount; i++) {
    const gfx = new Graphics();
    gfx.circle(0, 0, 2.5).fill({ color: 0xf7e48a, alpha: 0.9 });
    gfx.circle(0, 0, 5).fill({ color: 0xf7e48a, alpha: 0.2 });
    fireflyLayer.addChild(gfx);
    fireflyDots.push({ gfx, homeX: 0, homeY: 0, phase: fireflyRng() * Math.PI * 2 });
  }

  // Root growth (SPEC's "Continuous" entry): a couple of fixed, always-there
  // roots that lengthen slowly with total elapsed real session time.
  const rootRng = createStream(seed, 'render:surprise:roots');
  const rootsGfx = new Graphics();
  container.addChild(rootsGfx);
  const roots = Array.from({ length: surprisesConfig.rootCount }, () => ({
    x: rootRng() * WORLD_WIDTH,
    lean: (rootRng() - 0.5) * 20,
  }));
  let sessionElapsedSeconds = 0;

  let activeKind: SurpriseState['active'] = null;
  let activeInstanceId = -1;
  let elapsedSeconds = 0;
  let durationSeconds = 0;
  let reducedMotion = false;

  // Per-occurrence random parameters, regenerated only when a new instance
  // starts (see `setState`) — keeps a beetle's start point and direction
  // stable for its whole walk instead of jittering every frame.
  let walkRng: Rng = createStream(seed, 'render:surprise:none');
  let earthwormHeadX = 0;
  let earthwormHeadY = 0;
  let earthwormDirection = 1;
  let earthwormWiggleSeed = 0;
  let leafStartX = 0;

  function hideAll(): void {
    earthwormGfx.visible = false;
    beetle.visible = false;
    snail.visible = false;
    butterfly.visible = false;
    leaf.visible = false;
    fireflyLayer.visible = false;
  }

  function setState(state: SurpriseState): void {
    if (state.instanceId !== activeInstanceId) {
      activeInstanceId = state.instanceId;
      activeKind = state.active;
      hideAll();
      if (state.active) {
        walkRng = createStream(seed, `render:surprise:instance:${state.instanceId}`);
        if (state.active === 'earthworm') {
          earthwormHeadX = walkRng() * WORLD_WIDTH;
          earthwormHeadY = 40 + walkRng() * 200;
          earthwormDirection = walkRng() < 0.5 ? 1 : -1;
          earthwormWiggleSeed = walkRng() * Math.PI * 2;
        } else if (state.active === 'fallingLeaf') {
          leafStartX = walkRng() * WORLD_WIDTH;
        } else if (state.active === 'extraFireflies') {
          for (const dot of fireflyDots) {
            dot.homeX = walkRng() * WORLD_WIDTH;
            dot.homeY = -4 - walkRng() * 20;
            dot.gfx.position.set(dot.homeX, dot.homeY);
          }
        }
      }
    } else {
      activeKind = state.active;
    }
    elapsedSeconds = state.elapsedSeconds;
    durationSeconds = state.durationSeconds;
  }

  function updateEarthworm(): void {
    earthwormGfx.visible = true;
    const headX = earthwormHeadX + earthwormDirection * surprisesConfig.earthwormSpeed * elapsedSeconds;
    earthwormGfx.clear();
    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const segX = headX - earthwormDirection * t * surprisesConfig.earthwormLength;
      // The side-to-side wiggle is a flourish, not the worm's essential
      // motion (its slow pass through the soil) — reduced motion holds it
      // to a straight line instead.
      const segWiggle = reducedMotion ? 0 : Math.sin(elapsedSeconds * 0.4 + earthwormWiggleSeed - t * 1.5) * 14;
      const radius = 2.2 * (1 - t * 0.4);
      earthwormGfx.circle(segX, earthwormHeadY + segWiggle, radius).fill({ color: hex(palette.earthworm), alpha: 0.85 - t * 0.3 });
    }
  }

  function updateFallingLeaf(): void {
    const startY = -60;
    const fallDuration = Math.abs(startY) / surprisesConfig.fallingLeafFallSpeed;
    leaf.visible = true;
    if (elapsedSeconds < fallDuration) {
      const t = elapsedSeconds / fallDuration;
      leaf.y = lerp(startY, 0, t);
      // The fall itself (straight down, y above) still happens under
      // reduced motion — SPEC only calls out dropping the *flourish*
      // (sway/spin), not the leaf's essential falling motion.
      const sway = reducedMotion ? 0 : Math.sin(elapsedSeconds * surprisesConfig.fallingLeafSwaySpeed * Math.PI * 2);
      leaf.x = leafStartX + sway * surprisesConfig.fallingLeafSwayAmplitude;
      leaf.rotation = sway * 0.6;
      leaf.alpha = 1;
    } else {
      const restElapsed = elapsedSeconds - fallDuration;
      leaf.y = 0;
      leaf.x = leafStartX;
      leaf.rotation = 0;
      leaf.alpha = 1 - clamp01((restElapsed - surprisesConfig.fallingLeafRestSeconds) / surprisesConfig.fallingLeafFadeSeconds);
    }
  }

  return {
    container,
    setState,
    update(deltaSeconds: number, nightFactor: number): void {
      sessionElapsedSeconds += deltaSeconds;

      if (activeKind === 'earthworm') updateEarthworm();
      else if (activeKind === 'beetle') {
        beetle.visible = true;
        beetle.position.set(surfaceWalkerX(seed, activeInstanceId, elapsedSeconds, surprisesConfig.beetleSpeed, WORLD_WIDTH), SURFACE_Y);
      } else if (activeKind === 'snail') {
        snail.visible = true;
        snail.position.set(surfaceWalkerX(seed, activeInstanceId, elapsedSeconds, surprisesConfig.snailSpeed, WORLD_WIDTH), SURFACE_Y);
      } else if (activeKind === 'butterfly') {
        butterfly.visible = true;
        const t = durationSeconds > 0 ? elapsedSeconds / durationSeconds : 0;
        const startX = -30;
        const endX = WORLD_WIDTH + 30;
        butterfly.x = lerp(startX, endX, clamp01(t));
        const bob = reducedMotion ? 0 : Math.sin(elapsedSeconds * surprisesConfig.butterflyBobSpeed * Math.PI * 2) * surprisesConfig.butterflyBobAmplitude;
        butterfly.y = SURFACE_Y - 30 + bob;
      } else if (activeKind === 'fallingLeaf') {
        updateFallingLeaf();
      } else if (activeKind === 'extraFireflies') {
        fireflyLayer.visible = true;
        for (const dot of fireflyDots) {
          if (!reducedMotion) {
            const angle = sessionElapsedSeconds * 0.15 + dot.phase;
            dot.gfx.x = dot.homeX + Math.cos(angle) * 20;
            dot.gfx.y = dot.homeY + Math.sin(angle * 0.7) * 10;
          }
          const pulse = reducedMotion ? 0.7 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(sessionElapsedSeconds * 0.3 + dot.phase));
          // SPEC: "night" only — a dev-triggered preview during the day (or
          // a natural pick right at dusk, where the scheduler's own weight
          // is merely low rather than zero) fades to match, instead of
          // glowing at full strength against a bright sky.
          dot.gfx.alpha = pulse * nightFactor;
        }
      }

      // Root growth (SPEC: "continuous... almost imperceptible") — a slow,
      // saturating curve so it visibly lengthens over a long session
      // without ever looking like it's animating moment to moment.
      const growth = 1 - Math.exp(-(sessionElapsedSeconds / 60) / surprisesConfig.rootGrowthSaturationMinutes);
      const length = surprisesConfig.rootMaxLength * growth;
      rootsGfx.clear();
      for (const root of roots) {
        rootsGfx
          .moveTo(root.x, 0)
          .quadraticCurveTo(root.x + root.lean * 0.5, length * 0.5, root.x + root.lean, length)
          .stroke({ width: 1.4, color: hex(palette.root), alpha: 0.5, cap: 'round' });
      }
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
    fastForwardRoots(seconds: number): void {
      sessionElapsedSeconds += seconds;
    },
  };
}
