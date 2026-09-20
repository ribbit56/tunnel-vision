// Shared steering math (SPEC section 5 "Movement and pathing"): turning is
// always rate-limited ("no instant turns"), and approaching the end of a
// path slows down instead of arriving at full speed and snapping to a stop.
export function angleDiff(target: number, from: number): number {
  let d = (target - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns `current` toward `desired`, capped at `maxTurnRate` radians/second —
 * a hard limit, not just a soft spring, so nothing can snap to a new facing
 * in a single tick regardless of how it got there (a fresh path, a fresh
 * branch, a deflection off rock). */
export function turnToward(current: number, desired: number, maxTurnRate: number, dt: number): number {
  const diff = angleDiff(desired, current);
  const maxDelta = maxTurnRate * dt;
  if (diff > maxDelta) return current + maxDelta;
  if (diff < -maxDelta) return current - maxDelta;
  return current + diff;
}

/** SPEC's "arrive" behavior: full speed until within `slowRadius` of the
 * target, then eases down — never fully to zero, so the last approach still
 * reads as walking rather than freezing mid-step. */
export function arriveSpeedFactor(distanceToTarget: number, slowRadius: number): number {
  if (distanceToTarget >= slowRadius) return 1;
  return Math.max(0.2, distanceToTarget / slowRadius);
}

export interface Point {
  x: number;
  y: number;
}

/** SPEC's separation: nearby agents push gently apart so they don't overlap,
 * without needing to know anything about paths or tunnels. Returns one
 * offset per input position (same order), to be scaled and applied by the
 * caller (which also knows which resulting positions are actually walkable). */
export function computeSeparation(positions: Point[], radius: number): Point[] {
  const offsets: Point[] = positions.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[j].x - positions[i].x;
      const dy = positions[j].y - positions[i].y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 0 || dist >= radius) continue;
      const push = (radius - dist) / radius;
      const nx = dx / dist;
      const ny = dy / dist;
      offsets[i].x -= nx * push;
      offsets[i].y -= ny * push;
      offsets[j].x += nx * push;
      offsets[j].y += ny * push;
    }
  }
  return offsets;
}
