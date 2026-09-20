// Ant rendering (SPEC "Ants and brood"): three soft ellipses, a static body
// Graphics, plus a separately redrawn legs Graphics animated with a simple
// tripod gait (SPEC: "cycle rate matches speed"). The queen uses the same
// body shape at a larger size, plus a pair of wings that fade out during
// her founding walk.
import { Container, Graphics } from 'pixi.js';
import { antRender } from '../config';
import type { CarriedItem } from '../sim/ants/digger';
import { creatures } from '../theme/palette';

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

interface LegDef {
  baseX: number;
  restX: number;
  restY: number;
  /** Which of the two alternating gait groups this leg belongs to — one
   * group swings forward while the other pushes back, then they swap. */
  group: 0 | 1;
}

/** Six legs, matching the three body attachment points used in M2's static
 * drawing (front/middle/back on each side), alternating gait groups in
 * attachment order so consecutive legs move out of phase with each other. */
function buildLegDefs(length: number): LegDef[] {
  const defs: LegDef[] = [];
  let group: 0 | 1 = 0;
  for (let i = -1; i <= 1; i++) {
    const baseX = i * length * 0.13;
    defs.push({ baseX, restX: baseX - length * 0.22, restY: length * 0.32, group });
    group = group === 0 ? 1 : 0;
    defs.push({ baseX, restX: baseX + length * 0.05, restY: -length * 0.34, group });
    group = group === 0 ? 1 : 0;
  }
  return defs;
}

function buildAntBody(length: number, bodyColor: number, abdomenColor: number, highlightColor: number, outlineColor: number): Graphics {
  const gfx = new Graphics();
  const headR = length * 0.17;
  const thoraxR = length * 0.15;
  const abdomenRx = length * 0.27;
  const abdomenRy = length * 0.19;
  // A thin body outline (M11 contrast audit) — the fill stays dark for
  // legibility against grass; this rim is what keeps the ant visible
  // against the equally-dark tunnel interior underground.
  const outlineWidth = Math.max(0.6, length * 0.045);

  // Antennae.
  gfx
    .moveTo(-length * 0.42, -headR * 0.4)
    .lineTo(-length * 0.62, -length * 0.32)
    .stroke({ width: 1, color: bodyColor, cap: 'round' });
  gfx
    .moveTo(-length * 0.42, headR * 0.4)
    .lineTo(-length * 0.62, length * 0.32)
    .stroke({ width: 1, color: bodyColor, cap: 'round' });

  gfx
    .ellipse(length * 0.4, 0, abdomenRx, abdomenRy)
    .fill({ color: abdomenColor })
    .stroke({ width: outlineWidth, color: outlineColor, alpha: 0.8 });
  gfx
    .ellipse(length * 0.46, -abdomenRy * 0.35, abdomenRx * 0.45, abdomenRy * 0.32)
    .fill({ color: highlightColor, alpha: 0.5 });
  gfx
    .ellipse(0, 0, thoraxR, thoraxR * 0.85)
    .fill({ color: bodyColor })
    .stroke({ width: outlineWidth, color: outlineColor, alpha: 0.8 });
  gfx
    .ellipse(-length * 0.34, 0, headR, headR * 0.9)
    .fill({ color: bodyColor })
    .stroke({ width: outlineWidth, color: outlineColor, alpha: 0.8 });

  return gfx;
}

/** A pair of soft, translucent wings (SPEC: queen's founding sequence) — a
 * simple elongated ellipse each side, since they only need to read at a
 * glance before fading away. */
function buildWings(length: number, color: number): Graphics {
  const gfx = new Graphics();
  gfx.ellipse(length * 0.1, -length * 0.15, length * 0.55, length * 0.16).fill({ color });
  gfx.ellipse(length * 0.1, length * 0.15, length * 0.55, length * 0.16).fill({ color });
  return gfx;
}

function buildCarriedItemDot(color: number): Graphics {
  const gfx = new Graphics();
  gfx.circle(0, 0, 2.4).fill({ color });
  return gfx;
}

const CARRIED_ITEM_COLOR: Record<Exclude<CarriedItem, null>, string> = {
  pellet: creatures.crumb,
  egg: creatures.egg,
  larva: creatures.larva,
  pupa: creatures.pupa,
  seed: creatures.seed,
  crumb: creatures.crumb,
};

const WORKER_LENGTH = 9;

export interface AntSprite {
  container: Container;
  setPose(x: number, y: number, rotation: number, carryingItem: CarriedItem): void;
  /** Advances this ant's own gait cycle by `deltaSeconds` of real time at
   * the given world-px/s speed, and redraws its legs at the new phase.
   * Speed-driven and continuous, so legs never snap between poses. */
  updateGait(speed: number, deltaSeconds: number): void;
  /** Queen only (a no-op sprite still accepts calls harmlessly) — SPEC:
   * "wings flutter to the ground and fade." */
  setWingsAlpha(alpha: number): void;
}

/** A single ant — worker or queen — whose position/rotation/carried-item/
 * gait/wings are updated every frame from the live sim state. `sizeScale`
 * covers SPEC's undersized nanitic workers (0.8x); `isQueen` picks the
 * larger body and abdomen color, and adds a pair of wings. */
export function createAntSprite(isQueen: boolean, sizeScale: number): AntSprite {
  const container = new Container();
  const bodyLength = (isQueen ? 15 : WORKER_LENGTH) * (isQueen ? 1 : sizeScale);
  const bodyColor = hex(isQueen ? creatures.queenBody : creatures.workerBody);
  const abdomenColor = hex(isQueen ? creatures.queenAbdomenBand : creatures.workerBody);
  const legDefs = buildLegDefs(bodyLength);

  const wings = isQueen ? buildWings(bodyLength, hex(creatures.queenWings)) : null;
  if (wings) {
    wings.alpha = creatures.queenWingsAlpha;
    container.addChild(wings);
  }

  const legsGfx = new Graphics();
  container.addChild(legsGfx);
  container.addChild(buildAntBody(bodyLength, bodyColor, abdomenColor, hex(creatures.workerHighlight), hex(creatures.workerOutline)));

  let carriedDot: Graphics | null = null;
  let carriedDotKind: CarriedItem = null;

  let phase = 0;

  function redrawLegs(): void {
    legsGfx.clear();
    for (const leg of legDefs) {
      // Each gait group swings opposite the other: one group's stride sine
      // is offset by half a cycle from the other's.
      const groupPhase = phase + (leg.group === 1 ? Math.PI : 0);
      const stride = Math.sin(groupPhase) * bodyLength * antRender.strideAmplitude;
      // Lifts (shortens toward the body) during the forward half of its
      // swing, so it reads as stepping rather than dragging.
      const lift = Math.max(0, Math.sin(groupPhase)) * antRender.liftAmplitude;
      const footX = leg.restX + stride;
      const footY = leg.restY * (1 - lift);
      legsGfx
        .moveTo(leg.baseX, 0)
        .lineTo(footX, footY)
        .stroke({ width: Math.max(1, bodyLength * 0.06), color: bodyColor, cap: 'round' });
    }
  }
  redrawLegs();

  return {
    container,
    setPose(x: number, y: number, rotation: number, carryingItem: CarriedItem): void {
      container.x = x;
      container.y = y;
      container.rotation = rotation;

      if (carryingItem !== carriedDotKind) {
        carriedDotKind = carryingItem;
        if (carriedDot) {
          container.removeChild(carriedDot);
          carriedDot.destroy();
          carriedDot = null;
        }
        if (carryingItem) {
          carriedDot = buildCarriedItemDot(hex(CARRIED_ITEM_COLOR[carryingItem]));
          carriedDot.x = -bodyLength * 0.75;
          container.addChild(carriedDot);
        }
      }
    },
    updateGait(speed: number, deltaSeconds: number): void {
      const cyclesPerSecond = speed / antRender.strideLength;
      phase += cyclesPerSecond * Math.PI * 2 * deltaSeconds;
      redrawLegs();
    },
    setWingsAlpha(alpha: number): void {
      if (wings) wings.alpha = alpha * creatures.queenWingsAlpha;
    },
  };
}
