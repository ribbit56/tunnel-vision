// The terrain grid (SPEC section 3): density, hardness, and material per
// cell, generated once from the seed. Digging only ever lowers density —
// nothing here refills it, so "total volume dug" is always recoverable from
// the grid: sum(1 - density), less the founding entrance notch that was
// already open at creation (see `initialOpenVolume`).
import { createNoise2D } from 'simplex-noise';
import { createStream } from './rng';
import { generateStrata, interpBoundary, STRATA_BANDS, type StrataField } from './strata';

export const MATERIALS = [...STRATA_BANDS, 'rock'] as const;
export type Material = (typeof MATERIALS)[number];

const ROCK_ID = MATERIALS.indexOf('rock' as Material);

// Base hardness per material (0 = digs freely, 1 = undiggable), before the
// per-cell noise variation SPEC calls for ("hardness from seeded noise plus
// strata"). Rock is always 1 regardless of noise.
const BASE_HARDNESS: Record<Material, number> = {
  topsoil: 0.15,
  loam: 0.3,
  sandBand: 0.1,
  clay: 0.75,
  subsoil: 0.5,
  deep: 0.65,
  rock: 1,
};

export interface World {
  gridW: number;
  gridH: number;
  cellSize: number;
  /** 1 = fully solid, 0 = fully open. Digging only ever lowers this. */
  density: Float32Array;
  hardness: Float32Array;
  /** Index into MATERIALS. */
  material: Uint8Array;
  /** 0..1, updated by weather starting in M8; all zero until then. */
  moisture: Float32Array;
  /** The strata layout this grid was rasterized from, reused by the
   * renderer so the soil texture matches exactly what's diggable. */
  strata: StrataField;
  entranceCol: number;
  /** Open volume already present at creation (the founding entrance notch),
   * excluded from `totalVolumeDug` so that invariant reflects only what the
   * colony has actually dug, not the pre-existing entrance. */
  initialOpenVolume: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createWorld(seed: string, gridW: number, gridH: number, cellSize: number): World {
  const worldWidth = gridW * cellSize;
  const worldDepth = gridH * cellSize;
  const strata = generateStrata(seed, worldWidth, worldDepth);

  const cellCount = gridW * gridH;
  const density = new Float32Array(cellCount).fill(1);
  const hardness = new Float32Array(cellCount);
  const material = new Uint8Array(cellCount);
  const moisture = new Float32Array(cellCount);

  const hardnessNoise = createNoise2D(createStream(seed, 'world:hardness'));

  for (let cx = 0; cx < gridW; cx++) {
    const worldX = (cx + 0.5) * cellSize;
    const colBoundaries = strata.boundaries.map((row) =>
      interpBoundary(row, strata.columnWidth, worldX),
    );
    let bandIdx = 0;
    for (let cy = 0; cy < gridH; cy++) {
      const worldY = (cy + 0.5) * cellSize;
      while (bandIdx < STRATA_BANDS.length - 1 && worldY >= colBoundaries[bandIdx + 1]) bandIdx++;
      const materialName = STRATA_BANDS[bandIdx];
      const idx = cy * gridW + cx;
      material[idx] = MATERIALS.indexOf(materialName);
      const noiseVal = (hardnessNoise(worldX * 0.012, worldY * 0.012) + 1) / 2;
      hardness[idx] = clamp01(BASE_HARDNESS[materialName] * 0.7 + noiseVal * 0.3);
    }
  }

  for (const rock of strata.rocks) {
    const cx0 = Math.max(0, Math.floor((rock.x - rock.radius) / cellSize));
    const cx1 = Math.min(gridW - 1, Math.ceil((rock.x + rock.radius) / cellSize));
    const cy0 = Math.max(0, Math.floor((rock.y - rock.radius) / cellSize));
    const cy1 = Math.min(gridH - 1, Math.ceil((rock.y + rock.radius) / cellSize));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const worldX = (cx + 0.5) * cellSize;
        const worldY = (cy + 0.5) * cellSize;
        if (Math.hypot(worldX - rock.x, worldY - rock.y) <= rock.radius) {
          const idx = cy * gridW + cx;
          material[idx] = ROCK_ID;
          hardness[idx] = 1;
        }
      }
    }
  }

  // A small pre-opened entrance notch so the founding digger has somewhere
  // to start from (the queen's own founding dig is simulated from M5).
  const entranceCol = Math.round(gridW / 2);
  let initialOpenVolume = 0;
  for (let cy = 0; cy < 3; cy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const idx = cy * gridW + (entranceCol + dx);
      initialOpenVolume += density[idx];
      density[idx] = 0;
    }
  }

  return {
    gridW,
    gridH,
    cellSize,
    density,
    hardness,
    material,
    moisture,
    strata,
    entranceCol,
    initialOpenVolume,
  };
}

export function cellIndex(world: World, cx: number, cy: number): number {
  return cy * world.gridW + cx;
}

export function inBounds(world: World, cx: number, cy: number): boolean {
  return cx >= 0 && cx < world.gridW && cy >= 0 && cy < world.gridH;
}

/** SPEC section 3 invariant: no digging within `edgeMargin` cells of the
 * left, right, or bottom edge. The top (surface) has no such margin. */
export function isDiggable(world: World, cx: number, cy: number, edgeMargin: number): boolean {
  if (!inBounds(world, cx, cy)) return false;
  if (cx < edgeMargin || cx >= world.gridW - edgeMargin) return false;
  if (cy >= world.gridH - edgeMargin) return false;
  return world.material[cellIndex(world, cx, cy)] !== ROCK_ID;
}

export function sampleHardness(world: World, worldX: number, worldY: number): number {
  const cx = Math.floor(worldX / world.cellSize);
  const cy = Math.floor(worldY / world.cellSize);
  if (!inBounds(world, cx, cy)) return 1;
  return world.hardness[cellIndex(world, cx, cy)];
}

export interface DirtyRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DigResult {
  volumeRemoved: number;
  dirty: DirtyRect | null;
}

/**
 * Digs a soft elliptical brush centered at a world position (SPEC section 5
 * "Digging"). Equal radii give the normal round tunnel brush; a wider
 * `radiusXCells` than `radiusYCells` gives the flattened, wider-than-tall
 * shape SPEC uses for chambers. Harder ground resists more per application,
 * so tunnels visibly slow down and deflect around clay and rock. Never
 * touches rock or the edge-margin band.
 */
export function digBrush(
  world: World,
  worldX: number,
  worldY: number,
  radiusXCells: number,
  radiusYCells: number,
  edgeMargin: number,
): DigResult {
  const cx = worldX / world.cellSize;
  const cy = worldY / world.cellSize;
  const minX = Math.max(0, Math.floor(cx - radiusXCells));
  const maxX = Math.min(world.gridW - 1, Math.ceil(cx + radiusXCells));
  const minY = Math.max(0, Math.floor(cy - radiusYCells));
  const maxY = Math.min(world.gridH - 1, Math.ceil(cy + radiusYCells));

  let volumeRemoved = 0;
  let touched = false;

  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (!isDiggable(world, gx, gy, edgeMargin)) continue;
      const dist = Math.hypot((gx + 0.5 - cx) / radiusXCells, (gy + 0.5 - cy) / radiusYCells);
      if (dist > 1) continue;

      const idx = cellIndex(world, gx, gy);
      const before = world.density[idx];
      if (before <= 0) continue;

      const falloff = 1 - dist;
      const resistance = 1 - world.hardness[idx] * 0.6;
      const after = Math.max(0, before - 0.35 * falloff * resistance);
      world.density[idx] = after;
      volumeRemoved += before - after;
      touched = true;
    }
  }

  return {
    volumeRemoved,
    dirty: touched ? { minX, minY, maxX, maxY } : null,
  };
}

/** Combines two dirty rects (or passes the other through if one is null),
 * so a render frame that ran several sim steps can repaint once instead of
 * once per step. */
export function mergeDirty(a: DirtyRect | null, b: DirtyRect | null): DirtyRect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** A cell counts as "open" once density drops below this — matches the
 * midpoint of the shader's own smoothstep threshold, so what the sim
 * considers open lines up with what the render actually shows as a tunnel. */
export const OPEN_THRESHOLD = 0.5;

/**
 * SPEC invariant: "every open cell is connected to the entrance." Flood-fills
 * from the entrance and returns whether every open cell was reached.
 */
export function isConnectedToEntrance(world: World): boolean {
  const reached = new Uint8Array(world.gridW * world.gridH);
  const stack: number[] = [cellIndex(world, world.entranceCol, 0)];
  reached[stack[0]] = 1;

  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const cx = idx % world.gridW;
    const cy = Math.floor(idx / world.gridW);
    const neighbors: [number, number][] = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!inBounds(world, nx, ny)) continue;
      const nIdx = cellIndex(world, nx, ny);
      if (reached[nIdx] || world.density[nIdx] >= OPEN_THRESHOLD) continue;
      reached[nIdx] = 1;
      stack.push(nIdx);
    }
  }

  for (let i = 0; i < world.density.length; i++) {
    if (world.density[i] < OPEN_THRESHOLD && !reached[i]) return false;
  }
  return true;
}

/** Total soil removed so far, in the same cell-units digBrush reports —
 * exactly recoverable from the grid since digging never backfills. Used by
 * the soil-conservation test/invariant. */
export function totalVolumeDug(world: World): number {
  let sum = 0;
  for (let i = 0; i < world.density.length; i++) sum += 1 - world.density[i];
  return sum - world.initialOpenVolume;
}
