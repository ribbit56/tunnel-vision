// Turns the live terrain grid into the tunnel mask texture the shader reads
// (SPEC "Tunnel rendering": the mask holds `1 - density`, one texel per
// cell). Only repaints the touched sub-rectangle of the backing canvas each
// tick — the GPU upload itself is still a single `update()` call, since
// Pixi's public texture API doesn't expose a partial-upload path, but this
// keeps the per-tick CPU work proportional to what actually changed instead
// of the full 400x300 grid.
import { Texture } from 'pixi.js';
import type { DirtyRect, World } from '../sim/world';

export interface LiveMask {
  texture: Texture;
  /** Repaints `dirty` from the world's current density and re-uploads the
   * texture. Call with `null` to skip (nothing changed this tick). */
  sync(dirty: DirtyRect | null): void;
}

export function createLiveMask(world: World): LiveMask {
  const canvas = document.createElement('canvas');
  canvas.width = world.gridW;
  canvas.height = world.gridH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable while building the tunnel mask');

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';

  function paint(minX: number, minY: number, maxX: number, maxY: number): void {
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (!ctx) return;
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = minX + x;
        const gy = minY + y;
        const value = Math.round((1 - world.density[gy * world.gridW + gx]) * 255);
        const p = (y * w + x) * 4;
        image.data[p] = value;
        image.data[p + 1] = value;
        image.data[p + 2] = value;
        image.data[p + 3] = 255;
      }
    }
    ctx.putImageData(image, minX, minY);
    texture.source.update();
  }

  // First paint covers everything (the world starts almost entirely solid).
  paint(0, 0, world.gridW - 1, world.gridH - 1);

  return {
    texture,
    sync(dirty: DirtyRect | null): void {
      if (!dirty) return;
      paint(dirty.minX, dirty.minY, dirty.maxX, dirty.maxY);
    },
  };
}
