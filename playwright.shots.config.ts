import { defineConfig, devices } from '@playwright/test';

// Screenshot gallery for visual review (CLAUDE.md "Verifying your work").
// Not a pass/fail test suite — the point is the PNGs in screenshots/, looked
// at by eye against docs/reference/. Grows with each milestone; M0 just
// proves the pipeline with the placeholder sky/soil scene.
const webglArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: /shots\.spec\.ts/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { args: webglArgs },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
