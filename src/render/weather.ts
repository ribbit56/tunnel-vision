// Rain visuals (SPEC section 6 "Rain"): two parallax storm-cloud layers, a
// soft full-scene tint that dims the light while it's overcast, rain
// streaks and grass-line splashes, a handful of puddles that fill and
// drain, occasional ripples on them, and post-rain mushrooms.
//
// The moisture *front* itself is simulated per-cell in `sim/world.ts`
// (SPEC's `updateMoisture`) for a future feature to read, but rain here
// falls uniformly across the whole scene — there's nothing per-column for
// the renderer to gain by sampling that grid. So the wet-soil darkening
// below tracks its own simple smoothed scalar, driven by the same
// `intensity` value and the same rise/dry rates as the sim's row 0, rather
// than adding a second mask texture to the tunnel shader for a look that
// would end up visually identical (see the milestone report for the
// full reasoning) — one more instance of the render layer deriving its own
// cosmetic state from a shared environment value instead of reading the
// sim's, same as `sky.ts`'s star fade and `surface.ts`'s fireflies both
// derive independently from `nightFactor`.
import { BlurFilter, Container, Graphics } from 'pixi.js';
import { surfaceFeatures, weather as weatherConfig, world as worldConfig } from '../config';
import type { WeatherState } from '../environment/weather';
import { createStream, type Rng } from '../sim/rng';
import { tunnels as tunnelPalette, weather as weatherPalette } from '../theme/palette';

export interface WeatherRenderer {
  container: Container;
  setWeather(state: WeatherState): void;
  update(deltaSeconds: number): void;
  setReducedMotion(reduced: boolean): void;
}

const WORLD_WIDTH = worldConfig.gridW * worldConfig.cellSize;
const SKY_TOP_Y = -worldConfig.skyHeightAboveSurface;
const WET_BAND_DEPTH = weatherConfig.moistureMaxDepthCells * worldConfig.cellSize;

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Approaches `target` quickly whenever it's above the current value, but
 * always drains slowly regardless — the shape SPEC's "rises fast while
 * raining, dries out over about 10 minutes" calls for, shared by the
 * wet-soil band and the puddles below. */
function approachThenDrain(current: number, target: number, riseRate: number, drainRate: number, dt: number): number {
  let value = current;
  if (target > value) value += (target - value) * riseRate * dt;
  value -= value * drainRate * dt;
  return clamp01(value);
}

function randomOffEntranceX(rng: Rng): number {
  let x: number;
  do {
    x = rng() * WORLD_WIDTH;
  } while (Math.abs(x - surfaceFeatures.entranceX) < surfaceFeatures.entranceKeepout);
  return x;
}

interface CloudLayer {
  container: Container;
  speed: number;
}

/** One parallax layer of soft, blurred grey blobs — the same "string of
 * overlapping circles, blurred" technique `sky.ts`'s decorative clouds use,
 * just bigger and darker so it reads as cover rather than a wisp. */
function buildCloudLayer(rng: Rng, count: number, blurStrength: number, speed: number): CloudLayer {
  const container = new Container();
  for (let i = 0; i < count; i++) {
    const gfx = new Graphics();
    const blobCount = 5 + Math.floor(rng() * 3);
    let x = 0;
    for (let b = 0; b < blobCount; b++) {
      const r = 40 + rng() * 40;
      x += r * 0.8;
      const y = (rng() - 0.5) * 30;
      gfx.circle(x, y, r).fill({ color: hex(weatherPalette.cloudCover), alpha: 0.6 });
      x += r * 0.5;
    }
    gfx.x = rng() * (WORLD_WIDTH + 300) - 150;
    gfx.y = SKY_TOP_Y + 30 + rng() * 170;
    container.addChild(gfx);
  }
  // One blur filter for the whole layer rather than one per cloud — a
  // single render-to-texture pass covering every puff in this layer, not
  // four separate ones (each of those is a real cost under software/ANGLE
  // WebGL, unlike on a real GPU).
  container.filters = [new BlurFilter({ strength: blurStrength })];
  return { container, speed };
}

interface Raindrop {
  gfx: Graphics;
  x: number;
  y: number;
  speed: number;
  active: boolean;
}

interface FadingCircle {
  gfx: Graphics;
  age: number;
  lifetime: number;
}

interface Mushroom extends FadingCircle {
  fadeStartAge: number;
}

function buildMushroom(rng: Rng, x: number, fadeSeconds: number): Mushroom {
  const gfx = new Graphics();
  const capColor = hex(weatherPalette.mushroomCap);
  const stemColor = hex(weatherPalette.mushroomStem);
  const scale = 0.7 + rng() * 0.6;
  gfx.rect(-1 * scale, -3 * scale, 2 * scale, 3 * scale).fill({ color: stemColor });
  gfx.ellipse(0, -3 * scale, 3.2 * scale, 2 * scale).fill({ color: capColor });
  gfx.x = x;
  gfx.y = 0;
  gfx.alpha = 0;
  // Mushrooms sit at full opacity for most of their life and only fade at
  // the very end, rather than dimming visibly from the moment they sprout.
  return { gfx, age: 0, lifetime: fadeSeconds, fadeStartAge: fadeSeconds * 0.4 };
}

export function createWeatherRenderer(seed: string): WeatherRenderer {
  const rng = createStream(seed, 'render:weather');
  const container = new Container();

  const cloudLayers = [
    buildCloudLayer(createStream(seed, 'render:weather:cloudsBack'), 2, 14, 6),
    buildCloudLayer(createStream(seed, 'render:weather:cloudsFront'), 2, 8, 11),
  ];
  for (const layer of cloudLayers) container.addChild(layer.container);

  // Softens the light while it's cloudy/raining — drawn once at full alpha
  // and covering the whole scene, then just modulated per frame so this
  // never needs redrawing.
  const cloudTint = new Graphics().rect(0, SKY_TOP_Y, WORLD_WIDTH, worldConfig.skyHeightAboveSurface + worldConfig.gridH * worldConfig.cellSize).fill({ color: hex(weatherPalette.cloudCover) });
  cloudTint.blendMode = 'multiply';
  cloudTint.alpha = 0;
  container.addChild(cloudTint);

  // Wet-soil darkening near the surface (SPEC section 7's already-reserved
  // `wetSoilMultiply`/`wetSoilMaxAlpha`) — a gradient baked once, faded out
  // by depth, then modulated by the smoothed `wetness` scalar below.
  const wetBand = new Graphics()
    .rect(0, 0, WORLD_WIDTH, WET_BAND_DEPTH)
    .fill({ color: hex(tunnelPalette.wetSoilMultiply) });
  wetBand.blendMode = 'multiply';
  wetBand.alpha = 0;
  container.addChild(wetBand);

  const rainLayer = new Container();
  container.addChild(rainLayer);
  // Grown lazily up to `maxRaindrops` (SPEC's pooling budget is a ceiling,
  // not a mandatory upfront allocation) — most sessions spend most of their
  // time at 0% rain, so building all 400 stroked-line Graphics at page load
  // would be pure wasted construction cost on every single session, the
  // same reasoning `scene.ts`'s ant-sprite pool already follows.
  const raindrops: Raindrop[] = [];
  function buildRaindrop(): Raindrop {
    const gfx = new Graphics()
      .moveTo(0, 0)
      .lineTo(weatherConfig.raindropLength * 0.25, weatherConfig.raindropLength)
      .stroke({ width: 1.3, color: hex(weatherPalette.raindrop), alpha: 0.5, cap: 'round' });
    gfx.visible = false;
    rainLayer.addChild(gfx);
    return { gfx, x: 0, y: 0, speed: 0, active: false };
  }

  const splashLayer = new Container();
  container.addChild(splashLayer);
  const splashes: FadingCircle[] = [];

  const puddleXs = Array.from({ length: weatherConfig.puddleCount }, () => randomOffEntranceX(rng));
  const puddleLayer = new Container();
  container.addChild(puddleLayer);
  const puddleGfx = puddleXs.map((x) => {
    const gfx = new Graphics().ellipse(0, -1, 16, 4).fill({ color: hex(weatherPalette.puddleWater) });
    gfx.x = x;
    gfx.alpha = 0;
    puddleLayer.addChild(gfx);
    return gfx;
  });

  const rippleLayer = new Container();
  container.addChild(rippleLayer);
  const ripples: FadingCircle[] = [];

  const mushroomLayer = new Container();
  container.addChild(mushroomLayer);
  const mushrooms: Mushroom[] = [];

  let phase: WeatherState['phase'] = 'clear';
  let intensity = 0;
  let wetness = 0;
  let puddleFill = 0;
  let rippleCooldown = 0;
  let reducedMotion = false;

  function setWeather(state: WeatherState): void {
    if (state.phase === 'clear' && phase !== 'clear' && rng() < weatherConfig.mushroomChance) {
      const count =
        weatherConfig.mushroomCountMin + Math.floor(rng() * (weatherConfig.mushroomCountMax - weatherConfig.mushroomCountMin + 1));
      for (let i = 0; i < count; i++) {
        const fadeSeconds = (weatherConfig.mushroomFadeMinutesMin + rng() * (weatherConfig.mushroomFadeMinutesMax - weatherConfig.mushroomFadeMinutesMin)) * 60;
        const mushroom = buildMushroom(rng, randomOffEntranceX(rng), fadeSeconds);
        mushroomLayer.addChild(mushroom.gfx);
        mushrooms.push(mushroom);
      }
    }
    phase = state.phase;
    intensity = state.intensity;
  }

  function spawnRaindrop(drop: Raindrop): void {
    drop.x = rng() * WORLD_WIDTH;
    drop.y = SKY_TOP_Y + 60 + rng() * 60;
    drop.speed = weatherConfig.raindropFallSpeedMin + rng() * (weatherConfig.raindropFallSpeedMax - weatherConfig.raindropFallSpeedMin);
    drop.active = true;
    drop.gfx.position.set(drop.x, drop.y);
    drop.gfx.visible = true;
  }

  function spawnFadingCircle(pool: FadingCircle[], layer: Container, x: number, y: number, radius: number, color: number, lifetime: number, strokeOnly: boolean, cap: number): void {
    if (pool.length >= cap) return;
    const gfx = new Graphics();
    if (strokeOnly) gfx.circle(0, 0, radius).stroke({ width: 1.2, color, alpha: 0.6 });
    else gfx.circle(0, 0, radius).fill({ color, alpha: 0.5 });
    gfx.position.set(x, y);
    layer.addChild(gfx);
    pool.push({ gfx, age: 0, lifetime });
  }

  function updateFadingPool(pool: FadingCircle[], layer: Container, deltaSeconds: number, onDone?: (item: FadingCircle) => void): void {
    for (let i = pool.length - 1; i >= 0; i--) {
      const item = pool[i];
      item.age += deltaSeconds;
      const t = item.age / item.lifetime;
      if (t >= 1) {
        layer.removeChild(item.gfx);
        item.gfx.destroy();
        pool.splice(i, 1);
        continue;
      }
      onDone?.(item);
    }
  }

  return {
    container,
    setWeather,
    update(deltaSeconds: number): void {
      // SPEC: "clouds drift in on two parallax layers" — invisible (and, via
      // `visible`, skipped entirely by the renderer's filter pass) outside
      // clouding/rain/clearing, rather than a permanent fixture of every
      // scene regardless of weather.
      const cloudsVisible = intensity > 0.01;
      for (const layer of cloudLayers) {
        layer.container.visible = cloudsVisible;
        layer.container.alpha = intensity;
        if (!cloudsVisible) continue;
        for (const gfx of layer.container.children as Graphics[]) {
          gfx.x += layer.speed * deltaSeconds;
          if (gfx.x > WORLD_WIDTH + 150) gfx.x = -150;
        }
      }
      cloudTint.alpha = intensity * weatherConfig.cloudCoverAlphaMax;

      wetness = approachThenDrain(wetness, intensity, weatherConfig.moistureRiseRatePerSecond, weatherConfig.moistureDryRatePerSecond, deltaSeconds);
      wetBand.alpha = wetness * tunnelPalette.wetSoilMaxAlpha;

      puddleFill = approachThenDrain(puddleFill, intensity, weatherConfig.puddleFillRatePerSecond, weatherConfig.puddleDrainRatePerSecond, deltaSeconds);
      for (const gfx of puddleGfx) gfx.alpha = puddleFill;

      // SPEC section 10: "no rain streaks" under reduced motion — the tint
      // and puddles above still convey rain, just without falling particles.
      rainLayer.visible = !reducedMotion;
      if (!reducedMotion) {
        const desiredActive = Math.round(weatherConfig.maxRaindrops * intensity);
        while (raindrops.length < desiredActive) raindrops.push(buildRaindrop());
        for (let i = 0; i < raindrops.length; i++) {
          const drop = raindrops[i];
          if (i >= desiredActive) {
            if (drop.active) {
              drop.active = false;
              drop.gfx.visible = false;
            }
            continue;
          }
          if (!drop.active) spawnRaindrop(drop);
          drop.y += drop.speed * deltaSeconds;
          drop.x += drop.speed * deltaSeconds * 0.22;
          if (drop.y >= 0) {
            spawnFadingCircle(splashes, splashLayer, drop.x, 0, 3, hex(weatherPalette.splash), weatherConfig.splashFadeSeconds, true, weatherConfig.maxSplashes);
            spawnRaindrop(drop);
            drop.y = SKY_TOP_Y + 60 + rng() * 60;
          }
          drop.gfx.position.set(drop.x, drop.y);
        }
      }
      updateFadingPool(splashes, splashLayer, deltaSeconds, (item) => {
        item.gfx.alpha = 0.5 * (1 - item.age / item.lifetime);
      });

      // Puddle ripples: SPEC section 10 keeps these even under reduced
      // motion ("...puddle ripples only"), since they're small and gentle.
      rippleCooldown -= deltaSeconds;
      if (intensity > 0.3 && rippleCooldown <= 0 && puddleXs.length > 0) {
        rippleCooldown = weatherConfig.rippleIntervalSeconds;
        const x = puddleXs[Math.floor(rng() * puddleXs.length)];
        spawnFadingCircle(ripples, rippleLayer, x, -1, 2, hex(weatherPalette.puddleRipple), weatherConfig.rippleLifetimeSeconds, true, weatherConfig.maxRipples);
      }
      updateFadingPool(ripples, rippleLayer, deltaSeconds, (item) => {
        const t = item.age / item.lifetime;
        item.gfx.scale.set(1 + t * 5);
        item.gfx.alpha = 0.6 * (1 - t);
      });

      for (let i = mushrooms.length - 1; i >= 0; i--) {
        const mushroom = mushrooms[i];
        mushroom.age += deltaSeconds;
        if (mushroom.age >= mushroom.lifetime) {
          mushroomLayer.removeChild(mushroom.gfx);
          mushroom.gfx.destroy();
          mushrooms.splice(i, 1);
          continue;
        }
        mushroom.gfx.alpha = mushroom.age < mushroom.fadeStartAge ? 1 : 1 - (mushroom.age - mushroom.fadeStartAge) / (mushroom.lifetime - mushroom.fadeStartAge);
      }
    },
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },
  };
}
