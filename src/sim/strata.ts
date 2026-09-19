// Seeded strata generation (SPEC section 3 "Strata generation"). Pure data:
// band boundaries per column, plus rock/pebble/root placements. The renderer
// turns this into a texture; nothing here touches the DOM or Pixi.
import { createNoise2D } from 'simplex-noise';
import { createStream } from './rng';

export const STRATA_BANDS = ['topsoil', 'loam', 'sandBand', 'clay', 'subsoil', 'deep'] as const;
export type StrataMaterial = (typeof STRATA_BANDS)[number];

export interface Rock {
  x: number;
  y: number;
  radius: number;
}

export interface Pebble {
  x: number;
  y: number;
  radius: number;
}

export interface Root {
  points: { x: number; y: number }[];
}

export interface StrataField {
  /** boundaries[bandIndex][col] = world-y of the top of that band at that
   * column. boundaries[0] is always 0 (the grass line). There is one more
   * boundary than there are bands (the last is the bottom of "deep"). */
  boundaries: number[][];
  columns: number;
  columnWidth: number;
  rocks: Rock[];
  pebbles: Pebble[];
  roots: Root[];
}

// Base thickness as a fraction of world depth, before per-seed variation and
// per-column warp. Clay is deliberately allowed to shrink to near zero so it
// reads as an occasional lens rather than a uniform layer.
const BASE_THICKNESS: Record<Exclude<StrataMaterial, 'deep'>, { min: number; max: number }> = {
  topsoil: { min: 0.05, max: 0.08 },
  loam: { min: 0.12, max: 0.2 },
  sandBand: { min: 0.04, max: 0.09 },
  clay: { min: 0.0, max: 0.07 },
  subsoil: { min: 0.14, max: 0.22 },
};

export function generateStrata(
  seed: string,
  worldWidth: number,
  worldDepth: number,
  columns = 160,
): StrataField {
  const rng = createStream(seed, 'strata');
  const warpNoise = createNoise2D(createStream(seed, 'strata:warp'));
  const columnWidth = worldWidth / columns;

  const thicknesses = (
    Object.keys(BASE_THICKNESS) as Exclude<StrataMaterial, 'deep'>[]
  ).map((material) => {
    const { min, max } = BASE_THICKNESS[material];
    return (min + rng() * (max - min)) * worldDepth;
  });

  // Cumulative base depth of each boundary (before warp), deep fills the rest.
  const baseDepths: number[] = [0];
  for (const t of thicknesses) baseDepths.push(baseDepths[baseDepths.length - 1] + t);
  baseDepths.push(worldDepth);

  const warpAmplitude = worldDepth * 0.02;
  const warpFrequency = 0.9 / worldWidth; // roughly one undulation per world width

  const boundaries: number[][] = baseDepths.map((baseDepth, bandIndex) => {
    if (bandIndex === 0) return new Array(columns).fill(0);
    const row: number[] = [];
    let prev = -Infinity;
    for (let col = 0; col < columns; col++) {
      const x = col * columnWidth;
      const warp = warpNoise(x * warpFrequency, bandIndex * 11.7) * warpAmplitude;
      const minGap = 4;
      const y = Math.max(baseDepth + warp, prev + minGap);
      row.push(Math.min(y, worldDepth));
      prev = y;
    }
    return row;
  });

  const rocks: Rock[] = [];
  const rockCount = 8 + Math.floor(rng() * 8);
  for (let i = 0; i < rockCount; i++) {
    rocks.push({
      x: rng() * worldWidth,
      // Bias rocks toward the lower half of the soil.
      y: worldDepth * (0.35 + rng() * 0.6),
      radius: 8 + rng() * 22,
    });
  }

  const pebbles: Pebble[] = [];
  const pebbleCount = Math.round((worldWidth * worldDepth) / 9000);
  for (let i = 0; i < pebbleCount; i++) {
    pebbles.push({
      x: rng() * worldWidth,
      y: rng() * worldDepth,
      radius: 1.2 + rng() * 2.6,
    });
  }

  const roots: Root[] = [];
  const rootCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < rootCount; i++) {
    const startX = rng() * worldWidth;
    const depth = worldDepth * (0.15 + rng() * 0.25);
    const points = [{ x: startX, y: 0 }];
    const steps = 6;
    let x = startX;
    for (let s = 1; s <= steps; s++) {
      const y = (depth * s) / steps;
      x += (rng() - 0.5) * 18;
      points.push({ x, y });
    }
    roots.push({ points });
  }

  return { boundaries, columns, columnWidth, rocks, pebbles, roots };
}
