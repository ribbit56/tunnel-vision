// Bakes the seeded strata field into a single render texture (SPEC "Soil
// texture"): warped bands, grain speckle, pebbles, rocks, and roots. Built
// once per seed; moisture darkening and depth dimming beyond the static bake
// below are applied live in the tunnel shader, not here.
import { Texture } from 'pixi.js';
import { interpBoundary, STRATA_BANDS, type StrataField } from '../sim/strata';
import { hexToRgb, type Rgb } from '../theme/colorMath';
import { strata as strataPalette } from '../theme/palette';

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function drawBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  rng: () => number,
): void {
  ctx.fillStyle = color;
  const lobes = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + rng() * 0.5;
    const dist = radius * 0.35 * rng();
    const r = radius * (0.6 + rng() * 0.5);
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Bakes a strata field (from `sim/world.ts`, so the picture matches exactly
 * what the sim is digging into) into a color texture.
 */
export function buildSoilTexture(
  seed: string,
  field: StrataField,
  worldWidth: number,
  worldDepth: number,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = worldWidth;
  canvas.height = worldDepth;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable while building soil texture');

  const image = ctx.createImageData(worldWidth, worldDepth);
  const data = image.data;
  const bandColors: Rgb[] = STRATA_BANDS.map((m) => hexToRgb(strataPalette[m]));

  // Grain jitter and blob placement both use their own seeded render-only
  // stream (CLAUDE.md: cosmetic randomness is separate from sim randomness).
  const grainRng = (() => {
    // Local mulberry32 avoids importing sim's createStream into render for
    // something this file-local; seeded the same way for determinism.
    let a = 0;
    for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) | 0;
    a = (a ^ 0x9e3779b9) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  for (let x = 0; x < worldWidth; x++) {
    const colBoundaries = field.boundaries.map((row) => interpBoundary(row, field.columnWidth, x));
    let bandIdx = 0;
    for (let y = 0; y < worldDepth; y++) {
      while (bandIdx < STRATA_BANDS.length - 1 && y >= colBoundaries[bandIdx + 1]) bandIdx++;
      const base = bandColors[bandIdx];
      const jitter = (grainRng() - 0.5) * 12;
      const idx = (y * worldWidth + x) * 4;
      data[idx] = clamp8(base.r + jitter);
      data[idx + 1] = clamp8(base.g + jitter);
      data[idx + 2] = clamp8(base.b + jitter);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  for (const rock of field.rocks) {
    drawBlob(ctx, rock.x, rock.y, rock.radius, strataPalette.rock, grainRng);
  }

  for (const pebble of field.pebbles) {
    ctx.fillStyle = grainRng() < 0.5 ? strataPalette.pebbles[0] : strataPalette.pebbles[1];
    ctx.beginPath();
    ctx.arc(pebble.x, pebble.y, pebble.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = strataPalette.roots;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  for (const root of field.roots) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    root.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return Texture.from(canvas);
}
