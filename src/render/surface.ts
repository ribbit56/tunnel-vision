// Surface dressing: grass tufts (swaying), a few flowers, one small plant,
// and the entrance opening with its crater rim (SPEC section 7 "Surface").
// All positioned in world space around y = 0. The mound itself is real
// simulation output now (sim/surface/mound.ts) and rendered separately in
// render/mound.ts, since it grows from what the digger actually carries up.
import { Container, Graphics } from 'pixi.js';
import { fireflies as firefliesConfig, grass as grassConfig, surfaceFeatures } from '../config';
import { createStream } from '../sim/rng';
import { creatures, surface as surfacePalette } from '../theme/palette';

export interface Surface {
  container: Container;
  /** `nightFactor` (0 full day, 1 full night) fades fireflies in and drives
   * their glow pulse (SPEC section 6). */
  update(deltaSeconds: number, nightFactor: number): void;
  /** CLAUDE.md "Respect prefers-reduced-motion" — freezes fireflies' drift
   * and pulse rather than hiding them outright. */
  setReducedMotion(reduced: boolean): void;
  /** SPEC section 6 "Rain": "one worker may plug the entrance with a pellet
   * and unplug it after the rain ends" — shows or hides that pellet. */
  setEntrancePlugged(plugged: boolean): void;
}

const WORLD_WIDTH = 1600;
const DEG_TO_RAD = Math.PI / 180;

interface Tuft {
  container: Container;
  phase: number;
  ampScale: number;
}

function buildBlade(height: number, lean: number, color: number): Graphics {
  const gfx = new Graphics();
  gfx
    .moveTo(0, 0)
    .quadraticCurveTo(lean * 0.5, -height * 0.55, lean, -height)
    .stroke({ width: 2.2, color, cap: 'round' });
  return gfx;
}

function buildTuft(rng: () => number): Container {
  const container = new Container();
  const bladeColors = [
    surfacePalette.grassDark,
    surfacePalette.grassMid,
    surfacePalette.grassLight,
  ];
  const bladeCount = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < bladeCount; i++) {
    const height = 14 + rng() * 10;
    const lean = (rng() - 0.5) * 12;
    const colorHex = bladeColors[i % bladeColors.length];
    const color = parseInt(colorHex.replace('#', ''), 16);
    const blade = buildBlade(height, lean, color);
    blade.x = (rng() - 0.5) * 6;
    container.addChild(blade);
  }
  return container;
}

function buildFlower(rng: () => number): Graphics {
  const colors = surfacePalette.flowerAccents.map((c) => parseInt(c.replace('#', ''), 16));
  const color = colors[Math.floor(rng() * colors.length)];
  const gfx = new Graphics();
  const petalCount = 5;
  const radius = 3.2;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    gfx.circle(Math.cos(angle) * radius, Math.sin(angle) * radius, radius * 0.8).fill({ color });
  }
  gfx.circle(0, 0, radius * 0.7).fill({ color: 0xf3ead6 });
  gfx.y = -12 - rng() * 4;
  return gfx;
}

interface Firefly {
  gfx: Graphics;
  homeX: number;
  homeY: number;
  driftPhase: number;
  pulsePhase: number;
}

function buildFirefly(): Graphics {
  const gfx = new Graphics();
  const r = firefliesConfig.glowRadius;
  const color = parseInt(creatures.fireflyGlow.replace('#', ''), 16);
  gfx.circle(0, 0, r * 2.5).fill({ color, alpha: 0.22 });
  gfx.circle(0, 0, r).fill({ color, alpha: 1 });
  return gfx;
}

function buildEntrance(): Graphics {
  const gfx = new Graphics();
  const r = surfaceFeatures.entranceRadius;
  gfx.ellipse(0, 0, r * 1.6, r * 0.55).fill({
    color: parseInt(surfacePalette.moundSettled.slice(1), 16),
    alpha: 0.6,
  });
  gfx.ellipse(0, 0, r, r * 0.4).fill({ color: 0x140d09 });
  return gfx;
}

/** A small pellet-colored cap over the entrance opening (SPEC section 6:
 * plugged with a pellet while it rains). Sized to sit just inside the dark
 * opening `buildEntrance` draws, so it reads as blocking it rather than
 * covering the whole crater. */
function buildEntrancePlug(): Graphics {
  const gfx = new Graphics();
  const r = surfaceFeatures.entranceRadius;
  gfx.ellipse(0, 0, r * 0.85, r * 0.32).fill({ color: parseInt(surfacePalette.moundFreshPellet.slice(1), 16) });
  gfx.visible = false;
  return gfx;
}

export function createSurface(seed: string): Surface {
  const rng = createStream(seed, 'render:surface');
  const container = new Container();

  const entrance = buildEntrance();
  entrance.x = surfaceFeatures.entranceX;
  container.addChild(entrance);

  const entrancePlug = buildEntrancePlug();
  entrancePlug.x = surfaceFeatures.entranceX;
  container.addChild(entrancePlug);

  const tufts: Tuft[] = [];
  for (let i = 0; i < grassConfig.tuftCount; i++) {
    const x = rng() * WORLD_WIDTH;
    // Keep the grass from growing directly out of the entrance/mound.
    if (Math.abs(x - surfaceFeatures.entranceX) < surfaceFeatures.entranceKeepout) continue;
    const tuft = buildTuft(rng);
    tuft.x = x;
    tuft.y = 0;
    container.addChild(tuft);
    tufts.push({ container: tuft, phase: rng() * Math.PI * 2, ampScale: 0.6 + rng() * 0.8 });
  }

  for (let i = 0; i < grassConfig.flowerCount; i++) {
    const x = rng() * WORLD_WIDTH;
    if (Math.abs(x - surfaceFeatures.entranceX) < surfaceFeatures.entranceKeepout) continue;
    const flower = buildFlower(rng);
    flower.x = x;
    container.addChild(flower);
  }

  // One small plant: a taller, sturdier tuft that also sways.
  const plantX = WORLD_WIDTH * (0.15 + rng() * 0.2);
  const plant = buildTuft(rng);
  plant.scale.set(1.8);
  plant.x = plantX;
  container.addChild(plant);
  tufts.push({ container: plant, phase: rng() * Math.PI * 2, ampScale: 0.5 });

  // Fireflies (SPEC section 6): drift just above the grass, only visible as
  // night falls. A separate layer so their alpha (tied to night factor) is
  // independent of anything else in the container.
  const fireflyLayer = new Container();
  container.addChild(fireflyLayer);
  const fireflyList: Firefly[] = [];
  for (let i = 0; i < firefliesConfig.count; i++) {
    const gfx = buildFirefly();
    const homeX = rng() * WORLD_WIDTH;
    const homeY = -6 - rng() * 24;
    gfx.position.set(homeX, homeY);
    fireflyLayer.addChild(gfx);
    fireflyList.push({ gfx, homeX, homeY, driftPhase: rng() * Math.PI * 2, pulsePhase: rng() * Math.PI * 2 });
  }

  let elapsed = rng() * 10;
  let reducedMotion = false;

  return {
    container,
    update(deltaSeconds: number, nightFactor: number): void {
      if (!reducedMotion) elapsed += deltaSeconds;
      for (const tuft of tufts) {
        const angle =
          Math.sin(elapsed * grassConfig.swaySpeed * Math.PI * 2 + tuft.phase) *
          grassConfig.swayAmplitude *
          tuft.ampScale *
          DEG_TO_RAD;
        tuft.container.rotation = angle;
      }

      for (const firefly of fireflyList) {
        if (!reducedMotion) {
          const driftAngle = elapsed * firefliesConfig.driftSpeed * Math.PI * 2 + firefly.driftPhase;
          firefly.gfx.x = firefly.homeX + Math.cos(driftAngle) * firefliesConfig.driftRadius;
          firefly.gfx.y = firefly.homeY + Math.sin(driftAngle * 0.7) * firefliesConfig.driftRadius * 0.5;
        }
        // A gentle breathing glow, never fully dark mid-pulse — reduced
        // motion holds it at the pulse's own midpoint instead of the peak,
        // so it still reads as "glowing," just perfectly still.
        const pulse = reducedMotion ? 0.7 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * firefliesConfig.pulseSpeed * Math.PI * 2 + firefly.pulsePhase));
        firefly.gfx.alpha = nightFactor * pulse;
      }
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
    setEntrancePlugged(plugged: boolean): void {
      entrancePlug.visible = plugged;
    },
  };
}
