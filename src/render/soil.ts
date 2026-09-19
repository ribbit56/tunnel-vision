// Orchestrates the soil layer: bakes the strata texture, paints the M1
// hand-authored tunnel mask, and wires them together through the tunnel
// filter (SPEC "Tunnel rendering").
import { Container, Sprite } from 'pixi.js';
import { world } from '../config';
import { buildSoilTexture } from './soilTexture';
import { buildHandAuthoredMask } from './tunnelMask';
import { createTunnelFilter } from './tunnels';

export interface Soil {
  container: Container;
}

export function createSoil(seed: string): Soil {
  const worldWidth = world.gridW * world.cellSize;
  const worldDepth = world.gridH * world.cellSize;

  const { texture } = buildSoilTexture(seed, worldWidth, worldDepth);
  const sprite = new Sprite(texture);
  sprite.width = worldWidth;
  sprite.height = worldDepth;

  const mask = buildHandAuthoredMask();
  sprite.filters = [createTunnelFilter(seed, mask)];

  const container = new Container();
  container.addChild(sprite);

  return { container };
}
