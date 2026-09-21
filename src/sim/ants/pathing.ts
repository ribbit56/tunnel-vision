// A* over open cells, plus string-pulling to turn the blocky grid path into
// a small number of straight-line waypoints (SPEC section 5: "A* over open
// cells... paths are smoothed... and string-pulling"). Callers are expected
// to cache the result themselves against `world.terrainGeneration` (see
// `ants/digger.ts`) rather than this module keeping its own cache — a path
// is only ever needed by the one agent following it, so a per-agent cache
// is simpler than a shared one and just as effective.
import { WALKABLE_THRESHOLD, cellIndex, inBounds, type World } from '../world';
import type { Point } from './steering';

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** WALKABLE_THRESHOLD, not the looser OPEN_THRESHOLD — see its definition in
 * world.ts. A* should only ever route an ant through ground that actually
 * looks open, not just barely cracked at the edge of a dig brush. */
export function isOpenCell(world: World, cx: number, cy: number): boolean {
  return inBounds(world, cx, cy) && world.density[cellIndex(world, cx, cy)] < WALKABLE_THRESHOLD;
}

const NEIGHBOR_OFFSETS: { dx: number; dy: number; cost: number }[] = [
  { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: -1, cost: Math.SQRT2 },
  { dx: 1, dy: -1, cost: Math.SQRT2 },
  { dx: -1, dy: 1, cost: Math.SQRT2 },
  { dx: 1, dy: 1, cost: Math.SQRT2 },
];

/**
 * A minimal binary min-heap of (cell index, fScore) pairs, used as A*'s open
 * set. Uses lazy deletion — a cell can be pushed again with a better score
 * instead of updating its existing entry in place — and the caller skips a
 * popped entry whose score no longer matches the current best (see
 * `findPath`), which is simpler to get right than a heap with decrease-key
 * and just as fast in practice. Without this, the open set was a plain
 * array rescanned for its minimum every iteration: fine for one ant's own
 * short local paths, but quadratic and far too slow once many ants are
 * pathing across a large, mature tunnel network (MILESTONES M3's "70 ants"
 * budget).
 */
class MinHeap {
  private indices: number[] = [];
  private scores: number[] = [];

  get size(): number {
    return this.indices.length;
  }

  push(index: number, score: number): void {
    this.indices.push(index);
    this.scores.push(score);
    let i = this.indices.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] <= this.scores[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  /** Returns [index, score] for the smallest score, or null if empty. */
  pop(): [number, number] | null {
    const n = this.indices.length;
    if (n === 0) return null;
    const topIndex = this.indices[0];
    const topScore = this.scores[0];
    const lastIndex = this.indices.pop() as number;
    const lastScore = this.scores.pop() as number;
    if (this.indices.length > 0) {
      this.indices[0] = lastIndex;
      this.scores[0] = lastScore;
      let i = 0;
      const n2 = this.indices.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < n2 && this.scores[left] < this.scores[smallest]) smallest = left;
        if (right < n2 && this.scores[right] < this.scores[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return [topIndex, topScore];
  }

  private swap(a: number, b: number): void {
    const ti = this.indices[a];
    this.indices[a] = this.indices[b];
    this.indices[b] = ti;
    const ts = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = ts;
  }
}

/**
 * A* over open cells from one world position to another, 8-connected (with
 * diagonal moves rejected if they'd cut across a solid corner, so paths
 * don't clip through walls). Returns cell-center waypoints, or null if no
 * path exists (e.g. the target isn't actually open).
 */
export function findPath(world: World, fromX: number, fromY: number, toX: number, toY: number): Point[] | null {
  const { gridW, gridH, cellSize } = world;
  const startCx = Math.floor(fromX / cellSize);
  const startCy = Math.floor(fromY / cellSize);
  const goalCx = Math.floor(toX / cellSize);
  const goalCy = Math.floor(toY / cellSize);

  // The start is wherever the ant already is — trust that, rather than
  // requiring it to pass the same strict walkable check as everywhere else.
  // An ant can (briefly, e.g. right as a digger finishes a step) be standing
  // in a cell that's open enough to be there but not yet past the stricter
  // bar new destinations are held to; it must still be able to path *away*
  // from wherever it legitimately already stands.
  if (!inBounds(world, startCx, startCy) || !isOpenCell(world, goalCx, goalCy)) return null;

  const cellCount = gridW * gridH;
  const startIdx = startCy * gridW + startCx;
  const goalIdx = goalCy * gridW + goalCx;
  if (startIdx === goalIdx) return [{ x: toX, y: toY }];

  const gScore = new Float64Array(cellCount).fill(Infinity);
  const fScore = new Float64Array(cellCount).fill(Infinity);
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const closed = new Uint8Array(cellCount);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startCx, startCy, goalCx, goalCy);

  const open = new MinHeap();
  open.push(startIdx, fScore[startIdx]);

  let popped = open.pop();
  while (popped) {
    const [current, poppedScore] = popped;
    // Lazy deletion: this cell may have been pushed more than once as its
    // score improved. Skip a stale copy rather than maintaining decrease-key.
    if (poppedScore <= fScore[current] && !closed[current]) {
      if (current === goalIdx) {
        const cells: Point[] = [];
        let c: number = current;
        while (c !== -1) {
          const cx = c % gridW;
          const cy = Math.floor(c / gridW);
          cells.push({ x: (cx + 0.5) * cellSize, y: (cy + 0.5) * cellSize });
          c = cameFrom[c];
        }
        cells.reverse();
        // Replace the endpoints with the exact requested positions so the
        // path starts and ends precisely where asked, not at a cell center.
        cells[0] = { x: fromX, y: fromY };
        cells[cells.length - 1] = { x: toX, y: toY };
        return cells;
      }

      closed[current] = 1;
      const cx = current % gridW;
      const cy = Math.floor(current / gridW);

      for (const { dx, dy, cost } of NEIGHBOR_OFFSETS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isOpenCell(world, nx, ny)) continue;
        const nIdx = ny * gridW + nx;
        if (closed[nIdx]) continue;
        if (cost > 1) {
          // Reject diagonal moves that would cut across a solid corner.
          if (!isOpenCell(world, cx + dx, cy) || !isOpenCell(world, cx, cy + dy)) continue;
        }
        const tentativeG = gScore[current] + cost;
        if (tentativeG < gScore[nIdx]) {
          cameFrom[nIdx] = current;
          gScore[nIdx] = tentativeG;
          fScore[nIdx] = tentativeG + heuristic(nx, ny, goalCx, goalCy);
          open.push(nIdx, fScore[nIdx]);
        }
      }
    }
    popped = open.pop();
  }

  return null;
}

/** Whether the straight segment from `a` to `b` stays entirely within open
 * cells, sampled every half a cell — used both by string-pulling and by
 * anything that wants to move or nudge an ant in a straight line without
 * risking clipping a wall the endpoints alone wouldn't reveal (a corner cut
 * across a bend, for instance).
 *
 * `a` itself is trusted rather than sampled: it's wherever the ant already
 * legitimately is (the same reasoning `findPath` uses for its start cell),
 * and a digging ant's current position in particular can briefly sit just
 * under the strict walkable bar right as it finishes a step there — since
 * digging stops the moment it heads off toward the surface, that exact spot
 * would never open up any further, and requiring it to already pass the
 * same bar as the ground ahead would leave the ant permanently unable to
 * find any direction at all to head off in. */
export function hasLineOfSight(world: World, a: Point, b: Point): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (world.cellSize * 0.5)));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const cx = Math.floor(x / world.cellSize);
    const cy = Math.floor(y / world.cellSize);
    if (!isOpenCell(world, cx, cy)) return false;
  }
  return true;
}

/**
 * Longest a single string-pulled segment is allowed to span (world px). A
 * tunnel dug by the correlated random walk in `ants/digger.ts` curves
 * gradually rather than running perfectly straight, so a chord across a long
 * enough stretch of it can drift outside the actual dug width even though
 * `hasLineOfSight`'s own sampling (every half a cell) technically clears —
 * the sampled points can each land just inside a gently curving tunnel while
 * the chord *between* them bows out past its wall, and the ant visibly
 * walking that chord bows out right along with it. Confirmed by tracing a
 * real case: a fresh, correctly-computed shaft job's path collapsed a
 * 326px-long first leg into one straight segment, and by partway along it
 * the ant had drifted 16px off that line into ground that had never been
 * dug at all — well outside a shaft's own ~18px dug diameter
 * (`digging.brushRadiusCells` in config.ts is 2.25 cells, 9px radius).
 * Capped to a bit over double that diameter: long enough to still
 * meaningfully straighten the blocky grid path over a normal, gently
 * curving stretch, short enough that any one chord can only bow out by a
 * small fraction of the tunnel's own width before the next real waypoint
 * corrects course. */
const MAX_STRING_PULL_SEGMENT_DISTANCE = 40;

/**
 * String-pulling: greedily extends a line of sight from each kept waypoint
 * as far as it can before the straight line would clip a wall or exceed
 * `MAX_STRING_PULL_SEGMENT_DISTANCE`, dropping everything in between. Turns
 * a blocky grid path into a handful of natural-looking straight segments
 * (SPEC section 5 "path smoothing") without over-straightening a stretch
 * that isn't actually straight.
 */
export function stringPull(world: World, points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  let anchor = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const anchorPoint = points[anchor];
    const candidate = points[i + 1];
    const dist = Math.hypot(candidate.x - anchorPoint.x, candidate.y - anchorPoint.y);
    if (dist > MAX_STRING_PULL_SEGMENT_DISTANCE || !hasLineOfSight(world, anchorPoint, candidate)) {
      result.push(points[i]);
      anchor = i;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
