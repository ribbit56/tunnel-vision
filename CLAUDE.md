# Tunnel Vision (working title)

A browser focus timer. While the user focuses, a colony of ants digs a nest in a
cross-section of soil beneath a storybook sky. The colony only grows while the
timer runs, so by the end of a session the nest (and the soil mound beside the
entrance) is a visible record of the focus the user put in. Every session grows
a different colony from a seed.

The single most important quality bar: **it must be beautiful, gentle, and
calming to leave open for hours.** When in doubt, choose slower, softer,
quieter, and fewer.

## Read these first

- `docs/SPEC.md`: the full design and technical spec. Source of truth.
- `docs/MILESTONES.md`: the build order, with acceptance criteria for each step.
- `docs/reference/`: mood-board images from the owner. Look at them before any
  visual work.

Work one milestone at a time. At the end of each milestone, stop, summarize what
changed, show screenshots, and wait for the owner's review before starting the
next one. Milestone 1 (art direction) is a hard sign-off gate.

## About the owner

Ben is a senior BI developer (SQL, DAX, some Python), not a TypeScript or
graphics specialist. He will review rather than hand-write most of this code.

- Explain design decisions in plain language, briefly.
- Prefer readable, well-named code over clever code. Comment the *why* in the
  simulation and shader code.
- When a choice is a matter of taste (colors, speeds, timings), expose it as a
  named constant in a config file so it can be tuned without hunting.

## Stack

- Vite + TypeScript (strict mode)
- PixiJS (latest stable) for WebGL rendering; `pixi-filters` only if needed
- `simplex-noise` for noise, with a seeded PRNG (see "Determinism")
- Tone.js for procedural ambient audio
- `@fontsource/alegreya` and `@fontsource/alegreya-sans` (self-hosted fonts)
- Vitest for simulation tests, Playwright for screenshots and smoke tests
- Deployed as a static site to GitHub Pages via GitHub Actions

Check current package versions and their APIs before using them; do not rely on
memory of older PixiJS versions (the v7 and v8 APIs differ substantially).

## Commands

```
npm run dev          # local dev server
npm run build        # production build to dist/
npm run preview      # serve the production build
npm test             # vitest (simulation unit tests)
npm run e2e          # playwright smoke tests
npm run shots        # playwright screenshot gallery into screenshots/
npm run lint
```

## Architecture rules (non-negotiable)

1. **Simulation and rendering are strictly separate.**
   - `src/sim/` is pure TypeScript. No DOM, no PixiJS, no `window`, no audio.
   - `src/render/` reads sim state and draws it. It never mutates sim state.
   - `src/audio/` reads sim and environment state and plays sound.
   - `src/ui/` is plain DOM/CSS layered over the canvas.
2. **Fixed timestep simulation** (see SPEC), with render interpolation.
3. **Timers come from timestamps**, never from counting frames or intervals.
4. **Environment state (time of day, weather, surprise schedule) is a pure
   function of seed and time** wherever possible, so it never needs catching up.
5. **Two clocks**: `realTime` (drives environment and ambient motion) and
   `focusTime` (drives colony growth). Growth systems only advance with
   `focusTime`.

## Determinism

- Never call `Math.random()` or `Date.now()` inside `src/sim/`.
- Use the project PRNG (`src/sim/rng.ts`, sfc32 or mulberry32) seeded from the
  session seed.
- Give each system its own RNG stream derived from `hash(seed + systemName)`, so
  adding a feature doesn't reshuffle every other system.
- Cosmetic-only randomness in the renderer (particles, grass sway phase) uses a
  separate render RNG and must not affect the sim.
- Same seed + same focus timeline must produce the same colony. There is a test
  for this; keep it passing.

## Visual rules

- Palette values live only in `src/theme/palette.ts`. No hard-coded colors
  elsewhere.
- Tunnels are never drawn as grid blocks. Use the smoothed mask + shader
  approach in SPEC section "Tunnel rendering".
- Nothing flickers, jitters, or snaps. Everything eases. No sudden sounds.
- Respect `prefers-reduced-motion` and the in-app reduced-motion setting.

## Verifying your work

You can't judge a calming visual from code alone. For any visual change:

1. Run `npm run shots` (or a targeted Playwright script) to capture screenshots.
2. Open and look at the PNGs yourself. Compare against `docs/reference/` and the
   palette in SPEC.
3. Critique honestly: harsh edges, saturated colors, clutter, jitter. Fix before
   reporting done.

Headless Chromium may need a software GL flag for WebGL (for example
`--use-angle=swiftshader` or `--enable-unsafe-swiftshader`, depending on the
Chromium version). Check what works and record it in `playwright.config.ts`.

Use dev mode (`?dev=1`, see SPEC) to jump the colony forward in time rather
than waiting. Use `?seed=<value>` to reproduce a colony.

## GitHub Pages notes

- Vite `base` must match the repository name (for example `/tunnel-vision/`).
  Read it from an env var so local dev still uses `/`.
- GitHub Pages cannot set custom HTTP headers, so `SharedArrayBuffer` is not
  available. Do not design around it.
- Audio can only start after a user gesture (the first Start click).

## Style

- Small modules, one responsibility each. Prefer plain functions and data over
  class hierarchies in `src/sim/`.
- Tunable numbers go in `src/config.ts` (sim, pacing, timings) or
  `src/theme/palette.ts` (colors), with a short comment on what they affect.
- UI copy: sentence case, plain verbs, no exclamation marks, no all-caps labels.
