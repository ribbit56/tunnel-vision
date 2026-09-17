// URL-derived session settings: the seed and dev-mode flag. This is the one
// place allowed to touch `window.location` and generate a fresh random seed
// (src/sim/ must stay a pure function of whatever seed it's given).

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface Session {
  seed: string;
  devMode: boolean;
}

export function readSession(location: Location = window.location): Session {
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  return {
    seed: seedParam && seedParam.length > 0 ? seedParam : randomSeed(),
    devMode: params.get('dev') === '1',
  };
}
