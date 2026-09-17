import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://<user>.github.io/<repo>/, so the
// build needs to know the repo name at build time. Local dev has no such
// prefix. See docs/SPEC.md section 14 (Deployment).
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
