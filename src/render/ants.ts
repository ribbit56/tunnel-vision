// Static ants for M1's art-direction lock (SPEC "Ants and brood"): three soft
// ellipses, thin legs and antennae as rounded-cap lines, a faint highlight on
// the abdomen. Real movement and behavior arrive in M3/M5 — this is only
// ever a still picture, positioned by hand to match the hand-authored tunnel
// mask in tunnelMask.ts.
import { Container, Graphics } from 'pixi.js';
import { creatures } from '../theme/palette';

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

export interface AntSpec {
  x: number;
  y: number;
  rotation: number;
  queen?: boolean;
  carryingPellet?: boolean;
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

export function buildAnt(spec: AntSpec): Container {
  const container = new Container();
  const length = spec.queen ? 15 : 9;
  const bodyColor = hex(spec.queen ? creatures.queenBody : creatures.workerBody);
  const highlight = hex(spec.queen ? creatures.queenAbdomenBand : creatures.workerHighlight);

  container.addChild(buildAntBody(length, bodyColor, highlight));

  if (spec.carryingPellet) {
    const pellet = buildPellet();
    pellet.x = -length * 0.75;
    container.addChild(pellet);
  }

  container.x = spec.x;
  container.y = spec.y;
  container.rotation = spec.rotation;
  return container;
}

export function createAnts(specs: AntSpec[]): Container {
  const container = new Container();
  for (const spec of specs) {
    container.addChild(buildAnt(spec));
  }
  return container;
}
