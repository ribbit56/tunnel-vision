// The auto-framing camera (SPEC section 7 "Camera"): eases to keep the
// whole nest plus the surface in view as the colony deepens, zooming out
// down to a minimum scale and panning below that. The user can drag and
// scroll to override it by hand; after a quiet period it eases back to
// auto framing on its own. Everything here moves through a critically
// damped spring, never a snap — SPEC: "The user should never notice it
// moving."
import { layout, world as worldConfig } from '../config';
import type { Planner } from '../sim/colony/planner';

const WORLD_WIDTH = worldConfig.gridW * worldConfig.cellSize;

/** How long (seconds) the camera takes to settle into a new auto-framing
 * target — SPEC: "critically damped spring with a time constant of about
 * 60 to 120 seconds." Deliberately near the slow end: this camera only
 * needs to react to the nest slowly deepening over many minutes, and a
 * slower spring makes the motion even less likely to catch the eye. */
const SPRING_TIME_CONSTANT_SECONDS = 90;
/** SPEC: "After 20 seconds without input, the camera eases back to auto
 * framing." */
const AUTO_RETURN_IDLE_SECONDS = 20;
/** SPEC: "zooming out down to a minimum scale of 0.6. Below that, it pans
 * instead." Below this scale the target simply stops shrinking further. */
const MIN_AUTO_SCALE = 0.6;
/** World px of breathing room kept around the nest's own extent when
 * framing it, so tunnels never run right up to the edge of the screen. */
const FRAMING_MARGIN = 160;

export interface NestBounds {
  minX: number;
  maxX: number;
  maxDepth: number;
}

/** The nest's current extent, from the planner's own permanent records
 * (shaft centerlines and chamber footprints) — cheap to recompute each
 * frame since there are at most a few hundred points across a session. */
export function computeNestBounds(planner: Planner, entranceX: number): NestBounds {
  let minX = entranceX - 100;
  let maxX = entranceX + 100;
  let maxDepth = 200;
  for (const shaft of planner.shafts) {
    for (const point of shaft.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      maxDepth = Math.max(maxDepth, point.y);
    }
  }
  for (const chamber of planner.chambers) {
    minX = Math.min(minX, chamber.x - chamber.radiusX);
    maxX = Math.max(maxX, chamber.x + chamber.radiusX);
    maxDepth = Math.max(maxDepth, chamber.y + chamber.radiusY);
  }
  return { minX, maxX, maxDepth };
}

interface AutoTarget {
  scale: number;
  centerX: number;
}

/**
 * A "cover" fit — the viewport is always fully filled, rather than a
 * "contain" fit that shrinks until *both* dimensions merely fit (which
 * leaves whichever dimension had spare room under-filled). On a typical
 * wide desktop window the world's own height need was the tighter
 * constraint, so contain-fit zoomed out to satisfy it and left the sides
 * empty — most desktop windows are noticeably wider than the roughly
 * square minimum-framing area, so this wasn't a rare edge case.
 *
 * Taking the larger of the two candidate scales (rather than the smaller)
 * means whichever dimension has spare room just shows *more* world than
 * the bare minimum (more sky/soil depth, or more width either side of the
 * nest) instead of leaving blank space — never a problem, since there's
 * always more soil/sky to show. The one thing this trades away is M4's
 * original "never crop the nest" guarantee on a narrow/tall window: a very
 * wide, mature nest could have its edges run past a narrow viewport. In
 * practice this doesn't regress phones specifically, since `MIN_AUTO_SCALE`
 * already stops the camera from zooming out indefinitely to keep a big
 * nest fully framed — a sufficiently wide nest already relies on the user
 * panning to see all of it either way.
 */
function computeAutoTarget(bounds: NestBounds, viewportWidth: number, viewportHeight: number): AutoTarget {
  const neededHeight = Math.max(layout.minVisibleWorldHeight, bounds.maxDepth + FRAMING_MARGIN);
  const neededWidth = Math.max(WORLD_WIDTH, bounds.maxX - bounds.minX + FRAMING_MARGIN * 2);

  const scaleForHeight = viewportHeight / neededHeight;
  const scaleForWidth = viewportWidth / neededWidth;
  const scale = Math.max(MIN_AUTO_SCALE, scaleForHeight, scaleForWidth);

  return { scale, centerX: (bounds.minX + bounds.maxX) / 2 };
}

/** A critically damped spring step (the "exact" approximation from Games
 * Programming Gems 4 / popularized as Unity's SmoothDamp): eases `current`
 * toward `target` over roughly `timeConstant` seconds, carrying `velocity`
 * across calls. Never overshoots and never needs manual clamping — that's
 * what "critically damped" buys over a plain lerp. */
function springTo(current: number, target: number, velocity: number, timeConstant: number, dt: number): { value: number; velocity: number } {
  const omega = 2 / timeConstant;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  const newVelocity = (velocity - omega * temp) * exp;
  const value = target + (change + temp) * exp;
  return { value, velocity: newVelocity };
}

export interface Camera {
  scale: number;
  centerX: number;
  /** World y positioned at the anchor line (see `layout.skyFraction`) —
   * usually 0 (the grass line) unless the user has dragged vertically. */
  centerYOffset: number;
  /** Applies this frame's drag delta (screen px) while the user is
   * actively dragging. */
  drag(dxScreen: number, dyScreen: number): void;
  /** Applies a scroll-wheel zoom step, centered roughly on the viewport
   * (SPEC just says "scroll to zoom," not zoom-to-cursor). */
  zoom(deltaScale: number): void;
  /** Advances the spring toward auto-framing (or holds at the user's own
   * framing, if they've interacted within the last 20s) by `dt` seconds. */
  update(dt: number, planner: Planner, entranceX: number, viewportWidth: number, viewportHeight: number): void;
  /** CLAUDE.md "Respect prefers-reduced-motion": SPEC section 10 — "camera
   * snaps between framings... instead of zooming." */
  setReducedMotion(reduced: boolean): void;
}

export function createCamera(): Camera {
  let scale = 1;
  let centerX = 0;
  let centerYOffset = 0;
  let scaleVelocity = 0;
  let centerXVelocity = 0;
  let centerYVelocity = 0;
  let secondsSinceInput = Infinity; // starts "long idle," so auto-framing applies immediately
  let initialized = false;
  let reducedMotion = false;

  return {
    get scale() {
      return scale;
    },
    get centerX() {
      return centerX;
    },
    get centerYOffset() {
      return centerYOffset;
    },
    drag(dxScreen: number, dyScreen: number): void {
      centerX -= dxScreen / scale;
      centerYOffset -= dyScreen / scale;
      secondsSinceInput = 0;
    },
    zoom(deltaScale: number): void {
      scale = Math.max(0.2, Math.min(3, scale + deltaScale));
      secondsSinceInput = 0;
    },
    update(dt: number, planner: Planner, entranceX: number, viewportWidth: number, viewportHeight: number): void {
      const bounds = computeNestBounds(planner, entranceX);
      const target = computeAutoTarget(bounds, viewportWidth, viewportHeight);

      if (!initialized) {
        // Land exactly on the correct starting frame instead of springing
        // into place from an arbitrary default — SPEC's "starts framed on
        // the lower sky... and top of soil" describes a stable opening
        // shot, not an intro animation.
        scale = target.scale;
        centerX = target.centerX;
        initialized = true;
        return;
      }

      secondsSinceInput += dt;
      if (secondsSinceInput < AUTO_RETURN_IDLE_SECONDS) return;

      if (reducedMotion) {
        // No continuous zoom/pan motion at all — jump straight to the new
        // framing the instant it changes, rather than easing into it.
        scale = target.scale;
        centerX = target.centerX;
        centerYOffset = 0;
        scaleVelocity = 0;
        centerXVelocity = 0;
        centerYVelocity = 0;
        return;
      }

      const scaleStep = springTo(scale, target.scale, scaleVelocity, SPRING_TIME_CONSTANT_SECONDS, dt);
      scale = scaleStep.value;
      scaleVelocity = scaleStep.velocity;

      const centerXStep = springTo(centerX, target.centerX, centerXVelocity, SPRING_TIME_CONSTANT_SECONDS, dt);
      centerX = centerXStep.value;
      centerXVelocity = centerXStep.velocity;

      // Auto framing always keeps the grass line at the usual anchor —
      // only a manual drag ever moves it away from 0.
      const centerYStep = springTo(centerYOffset, 0, centerYVelocity, SPRING_TIME_CONSTANT_SECONDS, dt);
      centerYOffset = centerYStep.value;
      centerYVelocity = centerYStep.velocity;
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
  };
}
