import { defineConfig, devices } from '@playwright/test';

// MILESTONES M11 "3-hour accelerated run" check, and anything else that
// needs to read real JS heap usage rather than approximate it in Node
// (CLAUDE.md "Verifying your work" — a memory-growth claim needs the actual
// browser engine, not a guess). `--js-flags=--expose-gc` exposes `window.gc`
// so each heap sample reflects what's actually still reachable, not just
// whatever the engine hasn't gotten around to collecting yet.
const webglArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const perfArgs = ['--js-flags=--expose-gc'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: /perf\.spec\.ts/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { args: [...webglArgs, ...perfArgs] },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
