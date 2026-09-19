// The mound beside the entrance (SPEC section 5 "Mound"): grows one column
// at a time as diggers deposit pellets, settling toward a natural
// crater-and-mound shape via a simple angle-of-repose relaxation.

/** How much height difference between neighboring columns is allowed before
 * material slides downhill (a taste/pacing constant — higher reads as
 * looser, drier soil; lower as a steeper, more cohesive pile). */
const ANGLE_OF_REPOSE_SLOPE = 0.35; // world px of height per column

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

function settle(mound: Mound): void {
  const passes = 6;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < mound.columns - 1; i++) {
      const diff = mound.height[i] - mound.height[i + 1];
      const excess = Math.abs(diff) - ANGLE_OF_REPOSE_SLOPE;
      if (excess <= 0) continue;
      const move = excess * 0.5;
      if (diff > 0) {
        mound.height[i] -= move;
        mound.height[i + 1] += move;
      } else {
        mound.height[i] += move;
        mound.height[i + 1] -= move;
      }
    }
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
