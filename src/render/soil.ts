// Orchestrates the soil layer: bakes the strata texture from the sim's
// terrain (so the picture matches exactly what's diggable), builds the live
// tunnel mask, and wires them together through the tunnel filter (SPEC
// "Tunnel rendering").
import { Container, FillGradient, Graphics, Sprite } from 'pixi.js';
import { world as worldConfig } from '../config';
import type { World } from '../sim/world';
import { strata as strataPalette } from '../theme/palette';
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

  const container = new Container();

  // A plain topsoil-to-deep gradient extending into the decorative overscan
  // margin either side of the functional grid (see `config.ts`'s
  // `world.backgroundMargin`) — the real strata texture is baked from the
  // sim's actual terrain field and can't simply be widened, but the camera
  // can now show more than the functional grid's width on a wide viewport
  // or a wide nest (`render/camera.ts`). This is never seen up close (real
  // digging never reaches past the grid's own edge margin), so it only
  // needs to read as "more soil, unfocused," not match the real texture.
  const backdrop = new Graphics();
  const backdropLeft = -worldConfig.backgroundMargin;
  const backdropWidth = worldWidth + worldConfig.backgroundMargin * 2;
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: strataPalette.topsoil },
      { offset: 1, color: strataPalette.deep },
    ],
  });
  backdrop.rect(backdropLeft, 0, backdropWidth, worldDepth).fill(gradient);
  container.addChild(backdrop);

  const texture = buildSoilTexture(seed, world.strata, worldWidth, worldDepth);
  const sprite = new Sprite(texture);
  sprite.width = worldWidth;
  sprite.height = worldDepth;

  const mask = createLiveMask(world);
  sprite.filters = [createTunnelFilter(seed, mask.texture)];
  container.addChild(sprite);

  return { container, mask };
}
