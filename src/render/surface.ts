// Surface dressing: grass tufts (swaying), a few flowers, one small plant,
// the entrance opening with its crater rim, and the mound beside it (SPEC
// section 7 "Surface"). All positioned in world space around y = 0.
import { Container, Graphics } from 'pixi.js';
import { grass as grassConfig, surfaceFeatures } from '../config';
import { createStream } from '../sim/rng';
import { surface as surfacePalette } from '../theme/palette';

export interface Surface {
  container: Container;
  update(deltaSeconds: number): void;
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

function buildMound(): Graphics {
  const gfx = new Graphics();
  const w = surfaceFeatures.moundWidth;
  const h = surfaceFeatures.moundHeight;
  gfx.ellipse(0, 0, w / 2, h).fill({ color: parseInt(surfacePalette.moundSettled.slice(1), 16) });
  gfx
    .ellipse(-w * 0.12, -h * 0.35, w * 0.22, h * 0.4)
    .fill({ color: parseInt(surfacePalette.moundFreshPellet.slice(1), 16), alpha: 0.8 });
  gfx
    .ellipse(w * 0.18, -h * 0.15, w * 0.18, h * 0.3)
    .fill({ color: parseInt(surfacePalette.moundFreshPellet.slice(1), 16), alpha: 0.6 });
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

export function createSurface(seed: string): Surface {
  const rng = createStream(seed, 'render:surface');
  const container = new Container();

  const mound = buildMound();
  mound.x = surfaceFeatures.entranceX + surfaceFeatures.moundWidth * 0.55;
  mound.y = 0;
  container.addChild(mound);

  const entrance = buildEntrance();
  entrance.x = surfaceFeatures.entranceX;
  container.addChild(entrance);

  const tufts: Tuft[] = [];
  for (let i = 0; i < grassConfig.tuftCount; i++) {
    const x = rng() * WORLD_WIDTH;
    // Keep the grass from growing directly out of the entrance/mound.
    if (Math.abs(x - surfaceFeatures.entranceX) < surfaceFeatures.moundWidth * 0.7) continue;
    const tuft = buildTuft(rng);
    tuft.x = x;
    tuft.y = 0;
    container.addChild(tuft);
    tufts.push({ container: tuft, phase: rng() * Math.PI * 2, ampScale: 0.6 + rng() * 0.8 });
  }

  for (let i = 0; i < grassConfig.flowerCount; i++) {
    const x = rng() * WORLD_WIDTH;
    if (Math.abs(x - surfaceFeatures.entranceX) < surfaceFeatures.moundWidth * 0.7) continue;
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

  let elapsed = rng() * 10;

  return {
    container,
    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      for (const tuft of tufts) {
        const angle =
          Math.sin(elapsed * grassConfig.swaySpeed * Math.PI * 2 + tuft.phase) *
          grassConfig.swayAmplitude *
          tuft.ampScale *
          DEG_TO_RAD;
        tuft.container.rotation = angle;
      }
    },
  };
}
