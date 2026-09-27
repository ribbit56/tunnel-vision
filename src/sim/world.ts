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
  /** 0..1, per SPEC section 6 "Rain" — see `updateMoisture`. */
  moisture: Float32Array;
  /** The strata layout this grid was rasterized from, reused by the
   * renderer so the soil texture matches exactly what's diggable. */
  strata: StrataField;
  entranceCol: number;
  /** Open volume already present at creation (the founding entrance notch),
   * excluded from `totalVolumeDug` so that invariant reflects only what the
   * colony has actually dug, not the pre-existing entrance. */
  initialOpenVolume: number;
  /** Cell-count shortest-path distance to the entrance, BFS'd over open
   * cells; `Infinity` where unreached. Ants heading to the surface (SPEC
   * section 5) follow its steepest descent rather than re-planning a full
   * path every tick. Recomputed on a throttle — see `recomputeDistanceField`. */
  distanceField: Float32Array;
  /** Bumped every time the terrain actually changes (a dig that removed
   * volume). Cheap signal callers use to know their cached paths or the
   * distance field are stale, without diffing the grid themselves. */
  terrainGeneration: number;
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
  // to start from (the queen's own founding dig is simulated from M5). The
  // core is fully open, but it's ringed with a soft halo rather than left as
  // a hard-edged rectangle: every tunnel dug afterward gets its open/solid
  // gradient from digBrush's own falloff, and this is the one piece of
  // terrain that bypasses digging entirely, so without a matching gradient
  // it's a knife-edge an ant's very first turn (heading back down into the
  // shaft after a surface trip) can straddle — bilinear openness dropping
  // fully solid just one cell outside the core, unlike anywhere else in the
  // world. That produced ants (including the founding queen) getting stuck
  // rotating in place forever right at the entrance, never over the 0.6
  // open-enough bar no matter which way they faced.
  const entranceCol = Math.round(gridW / 2);
  let initialOpenVolume = 0;
  for (let cy = 0; cy <= 3; cy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = entranceCol + dx;
      if (cx < 0 || cx >= gridW) continue;
      const isCore = cy < 3 && dx >= -1 && dx <= 1;
      const idx = cy * gridW + cx;
      const before = density[idx];
      const after = isCore ? 0 : before * 0.1;
      density[idx] = after;
      initialOpenVolume += before - after;
    }
  }

  const world: World = {
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
    distanceField: new Float32Array(cellCount).fill(Infinity),
    terrainGeneration: 0,
  };
  recomputeDistanceField(world);
  return world;
}

/** The world position ants path toward as "the entrance" — the center of
 * the founding notch dug in `createWorld`. A few px below y=0 rather than
 * exactly on it, so a path there always resolves to an actually-open cell. */
export function entrancePosition(world: World): { x: number; y: number } {
  return { x: (world.entranceCol + 0.5) * world.cellSize, y: world.cellSize * 1.5 };
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

  if (touched) world.terrainGeneration++;

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
 * midpoint of the shader's own smoothstep threshold (tunnels.frag.ts:
 * `smoothstep(0.45, 0.55, 1 - density)`), so what the sim considers dug out
 * at all lines up with the render's own open/solid boundary. Used for soil
 * bookkeeping and the "every open cell reaches the entrance" invariant. */
export const OPEN_THRESHOLD = 0.5;

/** A stricter threshold ant navigation uses instead of `OPEN_THRESHOLD`
 * (SPEC: "ants move only through open cells"). A cell can sit just under
 * `OPEN_THRESHOLD` — freshly cracked open at the edge of a dig brush — while
 * still rendering as mostly-solid soil, since the shader's own soft edge
 * only finishes opening up at density 0.45 (plus a little further for its
 * noise wobble). Routing ants only through cells comfortably past that keeps
 * them from visibly walking through ground that still looks unopened.
 *
 * This is still a per-cell check, though, and cells are coarser than the
 * pixel an ant is actually drawn at — see `bilinearOpenAmount` below for the
 * sub-cell-accurate version this doesn't cover. */
export const WALKABLE_THRESHOLD = 0.3;

/** How solid `bilinearOpenAmount` is allowed to read before a position no
 * longer counts as visually open (see that function). Chosen so that even
 * the tunnel shader's own noise wobble (`uWobbleAmount`, ±0.035 in
 * tunnels.frag.ts) can't push a position past this bound and still land in
 * the shader's own fully-open range (smoothstep reaching ~0.9, comfortably
 * past its solid-to-open transition) — this is deliberately a good deal
 * stricter than `WALKABLE_THRESHOLD`'s per-cell 0.3, not a duplicate of it. */
const VISUALLY_OPEN_THRESHOLD = 0.4;

/**
 * The tunnel shader (`render/shaders/tunnels.frag.ts`) never draws a hard
 * edge — its mask texture is bilinearly filtered, one texel per cell, texel
 * centers at cell centers — so the color at any given screen pixel blends
 * toward whichever neighboring cells are nearest, not just whichever cell
 * the pixel's coordinate happens to floor into. A position can sit in a
 * cell that's comfortably under `WALKABLE_THRESHOLD` and still render with
 * a visible tint of solid soil if it's close enough to a less-dug neighbor
 * for that blend to show — hugging a tunnel wall (SPEC: "hug tunnel floors
 * and walls slightly") is exactly the situation that puts a position there
 * on purpose. This mirrors that same bilinear sample in plain TypeScript
 * (CLAUDE.md: sim code can't reach into the shader itself) so anything
 * placing an ant can check "will this actually render as open" directly,
 * rather than trusting a per-cell threshold to imply it. Returns 0 (fully
 * solid) to 1 (fully open), matching the shader's own mask convention
 * (`1 - density`, linear-filtered) before its smoothstep is applied. */
export function bilinearOpenAmount(world: World, worldX: number, worldY: number): number {
  const gx = worldX / world.cellSize - 0.5;
  const gy = worldY / world.cellSize - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const sample = (cx: number, cy: number): number => {
    const clampedX = Math.max(0, Math.min(world.gridW - 1, cx));
    const clampedY = Math.max(0, Math.min(world.gridH - 1, cy));
    return 1 - world.density[cellIndex(world, clampedX, clampedY)];
  };
  const top = sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx;
  const bottom = sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Whether `(worldX, worldY)` will actually render as open ground, not just
 * technically pass a per-cell density check — see `bilinearOpenAmount`. */
export function isVisuallyOpen(world: World, worldX: number, worldY: number): boolean {
  return bilinearOpenAmount(world, worldX, worldY) >= 1 - VISUALLY_OPEN_THRESHOLD;
}

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

export interface MoistureConfig {
  moistureMaxDepthCells: number;
  moistureRiseRatePerSecond: number;
  moistureDryRatePerSecond: number;
  moistureFrontRatePerSecond: number;
}

/**
 * Advances `world.moisture` (SPEC section 6 "Rain": "a moisture front
 * descends from the surface into the soil... wet soil darkens. It dries over
 * about 10 minutes after rain ends"). `rainIntensity` is an externally-set
 * `realTime` value (CLAUDE.md "Two clocks"), the same way `nightFactor`
 * drives night-time behavior elsewhere — this runs every tick regardless of
 * `focusRunning`, since weather doesn't pause for a break any more than day
 * and night do.
 *
 * Rain falls uniformly, so every column at a given depth ends up with the
 * same moisture — there's nothing here that varies with x. Each row is
 * still computed and written across its full width (rather than storing one
 * value per depth) to keep `world.moisture` a plain per-cell grid matching
 * `density`/`hardness`, in case a future feature wants to read moisture at a
 * specific point rather than a whole row.
 */
/** One row's moisture this tick: pulled up toward `incoming` (row 0's own
 * rain, or the row above's freshly-updated value for deeper rows) at `rise`
 * per second whenever it's wetter than this row, plus a constant slow drain
 * at `dryRate` regardless — so a row only actually gets wetter while
 * something above it still is, but always dries a little even mid-rain,
 * giving the "rises fast, dries over ~10 minutes" shape SPEC calls for. */
function stepMoistureRow(previous: number, incoming: number, rise: number, dryRate: number, dt: number): number {
  let value = previous;
  if (incoming > value) value += (incoming - value) * rise * dt;
  value -= value * dryRate * dt;
  return Math.min(1, Math.max(0, value));
}

export function updateMoisture(world: World, rainIntensity: number, dt: number, cfg: MoistureConfig): void {
  const depth = Math.min(cfg.moistureMaxDepthCells, world.gridH);
  let above = rainIntensity;

  for (let cy = 0; cy < depth; cy++) {
    const rowStart = cy * world.gridW;
    const rise = cy === 0 ? cfg.moistureRiseRatePerSecond : cfg.moistureFrontRatePerSecond;
    const value = stepMoistureRow(world.moisture[rowStart], above, rise, cfg.moistureDryRatePerSecond, dt);
    world.moisture.fill(value, rowStart, rowStart + world.gridW);
    above = value;
  }
}

/**
 * Recomputes `world.distanceField` in place: a breadth-first flood fill from
 * the entrance over open cells, so every open cell's value is its shortest
 * path length (in cell steps) back to the surface. This is what lets an ant
 * "head for the entrance" by always stepping toward a smaller number, rather
 * than re-running A* to the same destination over and over. Cells that
 * aren't open, or aren't reachable yet, are left at `Infinity`.
 *
 * Callers (see `sim.ts`) throttle how often this runs, since a full BFS over
 * the whole grid on every tick would be wasteful when most ticks don't
 * change the terrain at all.
 */
export function recomputeDistanceField(world: World): void {
  const { gridW, distanceField } = world;
  distanceField.fill(Infinity);

  const startIdx = cellIndex(world, world.entranceCol, 0);
  // A plain array used as a FIFO queue with a head pointer, rather than
  // shift()ing it — this is a hot path (a full-grid BFS) and shift() is
  // O(n) per call, which would make the whole flood fill O(n^2).
  const queue: number[] = [startIdx];
  let head = 0;
  distanceField[startIdx] = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    const dist = distanceField[idx];
    const cx = idx % gridW;
    const cy = Math.floor(idx / gridW);
    const neighbors: [number, number][] = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!inBounds(world, nx, ny)) continue;
      const nIdx = cellIndex(world, nx, ny);
      // WALKABLE_THRESHOLD, not OPEN_THRESHOLD: this field only exists to
      // steer ants (see ants/digger.ts's `stepMovingToSurface`), so it
      // should only ever route them through cells they're actually allowed
      // to walk on.
      if (world.density[nIdx] >= WALKABLE_THRESHOLD) continue;
      if (distanceField[nIdx] !== Infinity) continue;
      distanceField[nIdx] = dist + 1;
      queue.push(nIdx);
    }
  }
}
