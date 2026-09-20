import { defineConfig, devices } from '@playwright/test';

// Headless Chromium has no GPU by default, so WebGL needs a software
// rasterizer. --use-angle=swiftshader (plus --enable-unsafe-swiftshader on
// newer Chromium, which otherwise blocks software WebGL as "unsafe") is what
// works in this environment; record any change here (CLAUDE.md "Verifying
// your work").
const webglArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

// Chromium can freeze a page's timers (both requestAnimationFrame AND
// setInterval/setTimeout) once it decides that page is "backgrounded" —
// independent of `document.hidden`, which can stay false the whole time.
// With `workers: 1` this suite's tests still run one after another in the
// SAME browser process, and a freshly created page occasionally gets
// deprioritized behind the just-closed previous one, silently pausing the
// app's ticker for several real seconds mid-test. These are the standard
// flags Playwright/Puppeteer docs recommend to turn that off for tests.
const backgroundingArgs = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

export default defineConfig({
  testDir: 'e2e',
  testMatch: /smoke\.spec\.ts/,
  // M6 added real `visibilitychange`-driven behavior (catch-up mode, per
  // SPEC section 8 "Returning to a hidden tab") — running multiple tests'
  // pages in parallel lets one worker's tab stealing OS-level focus mark
  // another's `document.hidden`, spuriously triggering catch-up mid-test.
  // This suite is small and fast enough that serializing it costs little.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { args: [...webglArgs, ...backgroundingArgs] },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
