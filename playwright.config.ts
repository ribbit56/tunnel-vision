import { defineConfig, devices } from '@playwright/test';

// Headless Chromium has no GPU by default, so WebGL needs a software
// rasterizer. --use-angle=swiftshader (plus --enable-unsafe-swiftshader on
// newer Chromium, which otherwise blocks software WebGL as "unsafe") is what
// works in this environment; record any change here (CLAUDE.md "Verifying
// your work").
const webglArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: /smoke\.spec\.ts/,
  fullyParallel: true,
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
