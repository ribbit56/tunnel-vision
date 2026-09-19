// Ant rendering (SPEC "Ants and brood"): three soft ellipses, thin legs and
// antennae as rounded-cap lines, a faint highlight on the abdomen. M2 only
// ever shows the one live digger; the queen, brood, and the rest of the cast
// return in M5 once the colony has a lifecycle to draw.
import { Container, Graphics } from 'pixi.js';
import { creatures } from '../theme/palette';

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

function buildAntBody(length: number, bodyColor: number, highlightColor: number): Graphics {
  const gfx = new Graphics();
  const headR = length * 0.17;
  const thoraxR = length * 0.15;
  const abdomenRx = length * 0.27;
  const abdomenRy = length * 0.19;

  // Legs first, so the body overlaps their attachment points.
  for (let i = -1; i <= 1; i++) {
    const baseX = i * length * 0.13;
    gfx
      .moveTo(baseX, 0)
      .lineTo(baseX - length * 0.22, length * 0.32)
      .stroke({ width: Math.max(1, length * 0.06), color: bodyColor, cap: 'round' });
    gfx
      .moveTo(baseX, 0)
      .lineTo(baseX + length * 0.05, -length * 0.34)
      .stroke({ width: Math.max(1, length * 0.06), color: bodyColor, cap: 'round' });
  }

  // Antennae.
  gfx
    .moveTo(-length * 0.42, -headR * 0.4)
    .lineTo(-length * 0.62, -length * 0.32)
    .stroke({ width: 1, color: bodyColor, cap: 'round' });
  gfx
    .moveTo(-length * 0.42, headR * 0.4)
    .lineTo(-length * 0.62, length * 0.32)
    .stroke({ width: 1, color: bodyColor, cap: 'round' });

  gfx.ellipse(length * 0.4, 0, abdomenRx, abdomenRy).fill({ color: bodyColor });
  gfx
    .ellipse(length * 0.46, -abdomenRy * 0.35, abdomenRx * 0.45, abdomenRy * 0.32)
    .fill({ color: highlightColor, alpha: 0.5 });
  gfx.ellipse(0, 0, thoraxR, thoraxR * 0.85).fill({ color: bodyColor });
  gfx.ellipse(-length * 0.34, 0, headR, headR * 0.9).fill({ color: bodyColor });

  return gfx;
}

function buildPellet(): Graphics {
  const gfx = new Graphics();
  gfx.circle(0, 0, 2.4).fill({ color: hex(creatures.crumb) });
  return gfx;
}

const WORKER_LENGTH = 9;

export interface DiggerSprite {
  container: Container;
  setPose(x: number, y: number, rotation: number, carryingPellet: boolean): void;
}

/** A single worker ant whose position/rotation/pellet are updated every
 * frame from the live sim state, rather than a fixed decorative pose. */
export function createDiggerSprite(): DiggerSprite {
  const container = new Container();
  container.addChild(
    buildAntBody(WORKER_LENGTH, hex(creatures.workerBody), hex(creatures.workerHighlight)),
  );

  const pellet = buildPellet();
  pellet.x = -WORKER_LENGTH * 0.75;
  pellet.visible = false;
  container.addChild(pellet);

  return {
    container,
    setPose(x: number, y: number, rotation: number, carryingPellet: boolean): void {
      container.x = x;
      container.y = y;
      container.rotation = rotation;
      pellet.visible = carryingPellet;
    },
  };
}
