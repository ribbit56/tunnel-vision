// Global screen-space treatment (SPEC section 7 "Look"): a faint paper grain
// over the whole scene and a very soft vignette. Lives in screen space (not
// world space) so it reads as a property of the "page," not the camera.
import { FillGradient, Graphics, Texture, TilingSprite } from 'pixi.js';
import { createNoise2D } from 'simplex-noise';
import { globalTreatment } from '../theme/palette';

export interface Overlay {
  container: TilingSprite;
  vignette: Graphics;
  resize(width: number, height: number): void;
}

function buildGrainTexture(): Texture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable while building grain texture');

  // A fixed, unseeded stream is fine here: this is a cosmetic screen-space
  // texture, not part of any seeded colony (CLAUDE.md "Determinism").
  const noise = createNoise2D();
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(((noise(x * 0.9, y * 0.9) + 1) / 2) * 255);
      const idx = (y * size + x) * 4;
      image.data[idx] = v;
      image.data[idx + 1] = v;
      image.data[idx + 2] = v;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = Texture.from(canvas);
  texture.source.addressMode = 'repeat';
  return texture;
}

export function createOverlay(): Overlay {
  const grain = new TilingSprite({ texture: buildGrainTexture(), width: 0, height: 0 });
  grain.blendMode = 'multiply';
  grain.alpha = globalTreatment.paperGrainOpacity;

  const vignette = new Graphics();

  function resize(width: number, height: number): void {
    grain.width = width;
    grain.height = height;

    const radius = Math.hypot(width, height) / 2;
    const gradient = new FillGradient({
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      innerRadius: radius * 0.55,
      outerCenter: { x: 0.5, y: 0.5 },
      outerRadius: radius,
      colorStops: [
        { offset: 0, color: 'rgba(0,0,0,0)' },
        { offset: 1, color: `rgba(0,0,0,${globalTreatment.vignetteStrength})` },
      ],
      textureSpace: 'local',
    });
    vignette.clear().rect(0, 0, width, height).fill(gradient);
  }

  return { container: grain, vignette, resize };
}
