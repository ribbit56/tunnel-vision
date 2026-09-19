// Renders the mound from the sim's real height-per-column data (SPEC
// section 5 "Mound") — it starts flat and only grows as pellets land, rather
// than the fixed decorative shape M1 used before the sim existed.
import { Container, Graphics } from 'pixi.js';
import type { Mound } from '../sim/surface/mound';
import { surface as surfacePalette } from '../theme/palette';

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

export interface MoundRenderer {
  container: Container;
  sync(mound: Mound): void;
}

export function createMoundRenderer(): MoundRenderer {
  const gfx = new Graphics();

  function sync(mound: Mound): void {
    if (!mound.dirty) return;
    mound.dirty = false;

    gfx.clear();
    let hasHeight = false;
    for (let i = 0; i < mound.columns; i++) {
      if (mound.height[i] > 0.5) {
        hasHeight = true;
        break;
      }
    }
    if (!hasHeight) return;

    gfx.moveTo(0, 0);
    for (let i = 0; i < mound.columns; i++) {
      gfx.lineTo(i * mound.columnWidth, -mound.height[i]);
    }
    gfx.lineTo(mound.columns * mound.columnWidth, 0);
    gfx.closePath();
    gfx.fill({ color: hex(surfacePalette.moundSettled) });
  }

  return { container: gfx, sync };
}
