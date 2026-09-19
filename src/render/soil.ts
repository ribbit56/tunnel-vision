// Orchestrates the soil layer: bakes the strata texture from the sim's
// terrain (so the picture matches exactly what's diggable), builds the live
// tunnel mask, and wires them together through the tunnel filter (SPEC
// "Tunnel rendering").
import { Container, Sprite } from 'pixi.js';
import type { World } from '../sim/world';
import { createLiveMask, type LiveMask } from './liveMask';
import { buildSoilTexture } from './soilTexture';
import { createTunnelFilter } from './tunnels';

export interface Soil {
  container: Container;
  mask: LiveMask;
}

export function createSoil(seed: string, world: World): Soil {
  const worldWidth = world.gridW * world.cellSize;
  const worldDepth = world.gridH * world.cellSize;

  const texture = buildSoilTexture(seed, world.strata, worldWidth, worldDepth);
  const sprite = new Sprite(texture);
  sprite.width = worldWidth;
  sprite.height = worldDepth;

  const mask = createLiveMask(world);
  sprite.filters = [createTunnelFilter(seed, mask.texture)];

  const container = new Container();
  container.addChild(sprite);

  return { container, mask };
}
