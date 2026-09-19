// Sky: gradient, sun/moon arcs, stars, and a couple of soft clouds. Time of
// day is driven by a single "hour" value (0-24). For M1 this is only ever set
// by the dev slider; SPEC section 6 makes it a pure function of real time
// once the environment system lands in M7.
import { BlurFilter, Container, FillGradient, Graphics } from 'pixi.js';
import { sky as skyConfig, world } from '../config';
import { createStream } from '../sim/rng';
import { creatures, sampleTimeOfDay } from '../theme/palette';

export interface Sky {
  container: Container;
  setHour(hours: number): void;
  update(deltaSeconds: number): void;
}

interface Star {
  gfx: Graphics;
  phase: number;
}

const SKY_TOP_Y = -world.skyHeightAboveSurface;
const SKY_WIDTH = world.gridW * world.cellSize;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Position and visibility of a body (sun/moon) travelling a soft arc. */
function arcPosition(
  hour: number,
  riseHour: number,
  setHour: number,
  apexY: number,
  baselineY: number,
): { x: number; y: number; alpha: number } | null {
  let h = hour;
  if (h < riseHour) h += 24;
  if (h < riseHour || h > setHour) return null;

  const t = (h - riseHour) / (setHour - riseHour);
  const x = t * SKY_WIDTH;
  const arc = Math.sin(t * Math.PI); // 0 at rise/set, 1 at apex
  const y = baselineY - arc * (baselineY - apexY);
  const alpha = smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
  return { x, y, alpha };
}

function makeGlowingBody(radius: number, color: number, glowAlpha: number): Graphics {
  const gfx = new Graphics();
  gfx.circle(0, 0, radius * 2.6).fill({ color, alpha: glowAlpha * 0.25 });
  gfx.circle(0, 0, radius * 1.6).fill({ color, alpha: glowAlpha * 0.4 });
  gfx.circle(0, 0, radius).fill({ color, alpha: 1 });
  return gfx;
}

function makeCloud(rng: () => number): Graphics {
  const gfx = new Graphics();
  const puffs = 4 + Math.floor(rng() * 3);
  let x = 0;
  for (let i = 0; i < puffs; i++) {
    const r = 26 + rng() * 22;
    x += r * 0.9;
    const y = (rng() - 0.5) * 14;
    gfx.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.55 });
    x += r * 0.55;
  }
  gfx.filters = [new BlurFilter({ strength: 6 })];
  return gfx;
}

export function createSky(seed: string): Sky {
  const container = new Container();
  const rng = createStream(seed, 'render:sky');

  const gradient = new Graphics();
  container.addChild(gradient);

  const stars: Star[] = [];
  const starLayer = new Container();
  container.addChild(starLayer);
  for (let i = 0; i < skyConfig.starCount; i++) {
    const gfx = new Graphics();
    const r = 0.6 + rng() * 1.2;
    gfx.circle(0, 0, r).fill({ color: creatures.stars, alpha: 1 });
    gfx.x = rng() * SKY_WIDTH;
    gfx.y = SKY_TOP_Y + rng() * (world.skyHeightAboveSurface - 60);
    starLayer.addChild(gfx);
    stars.push({ gfx, phase: rng() * Math.PI * 2 });
  }

  const cloudLayer = new Container();
  container.addChild(cloudLayer);
  const clouds: Graphics[] = [];
  for (let i = 0; i < skyConfig.cloudCount; i++) {
    const cloud = makeCloud(rng);
    cloud.x = rng() * SKY_WIDTH;
    cloud.y = SKY_TOP_Y + 60 + rng() * 140;
    cloudLayer.addChild(cloud);
    clouds.push(cloud);
  }

  const sun = makeGlowingBody(26, 0xfff3d6, 1);
  const moon = makeGlowingBody(18, 0xeef2f2, 1);
  container.addChild(sun, moon);

  let nightFactor = 0;
  let elapsed = rng() * 100; // desync cloud phases without affecting sim

  function setHour(hours: number): void {
    const colors = sampleTimeOfDay(hours);

    gradient.clear();
    const fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: colors.skyTop },
        { offset: 1, color: colors.skyHorizon },
      ],
    });
    gradient.rect(0, SKY_TOP_Y, SKY_WIDTH, world.skyHeightAboveSurface).fill(fill);

    const sunApex = SKY_TOP_Y + 24;
    const moonApex = SKY_TOP_Y + 55;
    const baseline = -20;

    const sunPos = arcPosition(hours, 5, 19, sunApex, baseline);
    sun.visible = sunPos !== null;
    if (sunPos) {
      sun.position.set(sunPos.x, sunPos.y);
      sun.alpha = sunPos.alpha;
    }

    const moonPos = arcPosition(hours, 17, 31, moonApex, baseline);
    moon.visible = moonPos !== null;
    if (moonPos) {
      moon.position.set(moonPos.x, moonPos.y);
      moon.alpha = moonPos.alpha;
    }

    // Stars fade in around dusk and out around dawn (SPEC section 6). Full
    // night spans across the midnight wrap (19:30 -> 4:30), so this can't be
    // a single smoothstep across the raw hour value.
    const h = ((hours % 24) + 24) % 24;
    if (h >= 19.5 || h <= 4.5) {
      nightFactor = 1;
    } else if (h >= 17.5) {
      nightFactor = smoothstep(17.5, 19.5, h);
    } else if (h <= 6.5) {
      nightFactor = 1 - smoothstep(4.5, 6.5, h);
    } else {
      nightFactor = 0;
    }
  }

  function update(deltaSeconds: number): void {
    elapsed += deltaSeconds;
    for (const star of stars) {
      const twinkle =
        1 - skyConfig.twinkleDepth * 0.5 * (1 + Math.sin(elapsed * skyConfig.twinkleSpeed + star.phase));
      star.gfx.alpha = nightFactor * twinkle;
    }
    for (const cloud of clouds) {
      cloud.x += skyConfig.cloudDriftSpeed * deltaSeconds;
      if (cloud.x > SKY_WIDTH + 120) cloud.x = -120;
    }
  }

  setHour(12);

  return { container, setHour, update };
}
