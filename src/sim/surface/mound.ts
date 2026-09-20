// The mound beside the entrance (SPEC section 5 "Mound"): grows one column
// at a time as diggers deposit pellets, settling toward a natural
// crater-and-mound shape via a simple angle-of-repose relaxation.

/** How much height difference between neighboring columns is allowed before
 * material slides downhill (a taste/pacing constant — higher reads as
 * looser, drier soil; lower as a steeper, more cohesive pile). ~2.2 world px
 * per 4px-wide column is close to real sand's ~30 degree angle of repose
 * (tan(30 deg) * columnWidth); the original 0.35 was closer to 5 degrees —
 * a slope so gentle that `settle`'s bounded pass count (see below) could
 * never actually reach it, so height just kept piling onto whichever few
 * columns pellets happened to land on instead of spreading (M11 polish
 * pass, per owner feedback that the mound reads as "too tall and pointy"). */
const ANGLE_OF_REPOSE_SLOPE = 2.2; // world px of height per column

export interface Mound {
  columns: number;
  columnWidth: number;
  /** World-px height above y = 0, per column. Always >= 0. */
  height: Float32Array;
  /** Cell-units deposited so far, for the soil-conservation invariant. */
  totalDeposited: number;
  /** Set whenever height changes; the renderer clears it after redrawing. */
  dirty: boolean;
}

export function createMound(columns: number, cellSize: number): Mound {
  return {
    columns,
    columnWidth: cellSize,
    height: new Float32Array(columns),
    totalDeposited: 0,
    dirty: false,
  };
}

/** Relaxes the whole mound to a stable angle-of-repose shape, not just a
 * fixed number of passes — a single-direction pairwise diffusion only
 * propagates a height difference one column further per pass, so a fixed
 * small pass count let a spike keep growing taller than it could ever
 * spread before the next pellet landed nearby. Looping until nothing moves
 * (bounded generously for safety) means every deposit leaves the pile
 * actually settled, regardless of how much material piled up on one spot. */
function settle(mound: Mound): void {
  const maxPasses = 300;
  for (let p = 0; p < maxPasses; p++) {
    let anyMoved = false;
    for (let i = 0; i < mound.columns - 1; i++) {
      const diff = mound.height[i] - mound.height[i + 1];
      const excess = Math.abs(diff) - ANGLE_OF_REPOSE_SLOPE;
      if (excess <= 0.01) continue;
      const move = excess * 0.5;
      if (diff > 0) {
        mound.height[i] -= move;
        mound.height[i + 1] += move;
      } else {
        mound.height[i] += move;
        mound.height[i + 1] -= move;
      }
      anyMoved = true;
    }
    if (!anyMoved) break;
  }
}

/**
 * Deposits one pellet's worth of soil (in the same cell-units digBrush
 * removes, so conservation is exact) at a world x, then settles the pile.
 * `mound.columnWidth === world.cellSize`, so a cell-area of material raised
 * over one column simplifies to a height gain of `volumeCells * cellSize`.
 */
export function depositPellet(mound: Mound, worldX: number, volumeCells: number): void {
  const col = Math.max(0, Math.min(mound.columns - 1, Math.floor(worldX / mound.columnWidth)));
  mound.height[col] += volumeCells * mound.columnWidth;
  mound.totalDeposited += volumeCells;
  mound.dirty = true;
  settle(mound);
}
