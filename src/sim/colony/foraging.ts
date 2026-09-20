// Surface food for foragers (SPEC section 5 "Roles": "foragers... pick up
// seeds and crumbs, bring them to the granary"). Deliberately simple —
// SPEC's richer weather-linked foraging (heading home when clouds arrive,
// etc.) arrives with rain in M8; this milestone just needs something for a
// forager role to actually do.
import type { Rng } from '../rng';
import { createStream } from '../rng';

export type FoodKind = 'seed' | 'crumb';

export interface FoodItem {
  id: number;
  kind: FoodKind;
  x: number;
  claimedByForager: boolean;
}

export interface ForagingConfig {
  spawnIntervalMinutesMin: number;
  spawnIntervalMinutesMax: number;
  maxUnclaimedFood: number;
  spawnRangeX: number;
}

export interface Foraging {
  food: FoodItem[];
  nextFoodId: number;
  granaryStored: number;
  nextSpawnMinutes: number;
  rng: Rng;
}

export function createForaging(seed: string, cfg: ForagingConfig): Foraging {
  const rng = createStream(seed, 'colony:foraging');
  return {
    food: [],
    nextFoodId: 0,
    granaryStored: 0,
    nextSpawnMinutes: cfg.spawnIntervalMinutesMin + rng() * (cfg.spawnIntervalMinutesMax - cfg.spawnIntervalMinutesMin),
    rng,
  };
}

/** Spawns a new food item near the entrance if it's time and there's room
 * (SPEC's granary is deeper underground; unclaimed food waiting on the
 * surface is capped so it doesn't visibly pile up). Only called while focus
 * is running, same as the rest of the lifecycle. */
export function updateForaging(foraging: Foraging, focusMinutes: number, entranceX: number, cfg: ForagingConfig): void {
  if (focusMinutes < foraging.nextSpawnMinutes) return;
  foraging.nextSpawnMinutes = focusMinutes + cfg.spawnIntervalMinutesMin + foraging.rng() * (cfg.spawnIntervalMinutesMax - cfg.spawnIntervalMinutesMin);

  const unclaimedCount = foraging.food.filter((item) => !item.claimedByForager).length;
  if (unclaimedCount >= cfg.maxUnclaimedFood) return;

  foraging.food.push({
    id: foraging.nextFoodId++,
    kind: foraging.rng() < 0.5 ? 'seed' : 'crumb',
    x: entranceX + (foraging.rng() - 0.5) * 2 * cfg.spawnRangeX,
    claimedByForager: false,
  });
}
