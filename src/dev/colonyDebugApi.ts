// SPEC section 11's debug API type, split out from main.ts (which actually
// implements it) so e2e tests — compiled under tsconfig.node.json, a
// separate TypeScript program from main.ts's tsconfig.app.json — can see the
// `window.__colony` global too. A `declare global` only reaches files inside
// the same program it's compiled in.
import type { ColonyStats } from './colonyStats';
import type { SurpriseKind } from '../environment/surprises';
import type { WeatherPhase } from '../environment/weather';

export interface ColonyDebugApi {
  setSeed(seed: string): void;
  setTimeScale(n: number): void;
  advanceFocus(minutes: number): void;
  setTimeOfDay(hours: number): void;
  setWeather(state: WeatherPhase | null): void;
  triggerSurprise(name: SurpriseKind): void;
  getStats(): ColonyStats;
  getStateHash(): string;
}

declare global {
  interface Window {
    __colony?: ColonyDebugApi;
  }
}
