// Static brood cluster for M1 (SPEC "Ants and brood"): soft pale ovals, eggs
// tiny, larvae slightly curved, pupae larger with a faint segment line.
import { Container, Graphics } from 'pixi.js';
import { createStream } from '../sim/rng';
import { creatures, strata } from '../theme/palette';

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

function buildEgg(): Graphics {
  return new Graphics().circle(0, 0, 1.6).fill({ color: hex(creatures.egg) });
}

function buildLarva(): Graphics {
  const gfx = new Graphics();
  gfx
    .moveTo(-3, 0.6)
    .quadraticCurveTo(0, -1.2, 3, 0.6)
    .stroke({ width: 2.6, color: hex(creatures.larva), cap: 'round' });
  return gfx;
}

function buildPupa(): Graphics {
  const gfx = new Graphics();
  gfx.ellipse(0, 0, 3.2, 2).fill({ color: hex(creatures.pupa) });
  gfx
    .moveTo(-1.6, 0)
    .lineTo(1.6, 0)
    .stroke({ width: 0.6, color: hex(strata.roots), alpha: 0.6 });
  return gfx;
}

export function createBroodCluster(seed: string, x: number, y: number, count = 6): Container {
  const rng = createStream(seed, 'render:brood');
  const container = new Container();
  container.x = x;
  container.y = y;

  for (let i = 0; i < count; i++) {
    const roll = rng();
    const item = roll < 0.4 ? buildEgg() : roll < 0.75 ? buildLarva() : buildPupa();
    item.x = (rng() - 0.5) * 20;
    item.y = (rng() - 0.5) * 6;
    item.rotation = (rng() - 0.5) * 0.6;
    container.addChild(item);
  }

  return container;
}
