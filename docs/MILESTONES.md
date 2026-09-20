# Milestones

Build in this order. Finish each milestone, verify it, show screenshots, and
stop for Ben's review before starting the next. Look before behavior: the art
style is locked in before any real simulation exists.

Each milestone lists its goal, scope, and "done when" criteria.

---

## M0. Scaffold and deploy pipeline

**Goal:** an empty but real project that deploys to GitHub Pages.

Scope:
- Vite + TypeScript (strict), PixiJS, ESLint, Prettier
- Vitest and Playwright configured (including the headless WebGL flag that works)
- `src/config.ts`, `src/theme/palette.ts` (all palette values from SPEC),
  `src/sim/rng.ts` (seeded PRNG with named streams)
- Seed from `?seed=` or random; `?dev=1` shows an empty dev panel
- A full-window Pixi canvas showing the day sky gradient and a flat soil color
- Fonts installed via `@fontsource`
- GitHub Actions workflow deploying to Pages with the correct `base`
- `.gitignore` includes `screenshots/`

Done when:
- `npm run dev`, `build`, `test`, `e2e` all work
- The deployed Pages URL shows the sky and soil with no console errors
- RNG test: same seed and stream name give the same sequence

---

## M1. Art direction lock (sign-off gate)

**Goal:** a static, beautiful cross-section that defines the look. No
simulation yet.

Scope:
- Sky gradient with the four time-of-day keyframes (dev slider to blend)
- Sun, moon, stars, a couple of soft clouds
- Grass tufts with gentle sway, a few flowers, one small plant
- Seeded strata soil texture: warped bands, grain, pebbles, rocks, roots,
  depth dimming
- Tunnel shader (SPEC section 7) driven by a **hand-authored** mask: an
  entrance, a main shaft, three chambers, a side shaft
- Static ants (a queen and a few workers, including one carrying a pellet) and
  a cluster of brood in a chamber
- A small mound beside the entrance
- Paper grain and vignette
- Static timer text and controls in place (not functional), in Alegreya and
  Alegreya Sans

Done when:
- Screenshots at dawn, day, dusk, night, at desktop and phone widths
- Tunnels have soft organic edges, a darker rim, and a lighter floor. No
  visible grid anywhere
- Palette matches SPEC; nothing looks saturated or harsh
- Timer is legible at every time of day
- **Ben approves the look.** Iterate here as long as needed; everything later
  depends on it

---

## M2. Living terrain and a single digger

**Goal:** real terrain data and one ant digging believably.

Scope:
- Terrain grid (density, hardness, material, moisture) generated from the seed
- Mask texture updates from the grid with dirty-region uploads
- One digger ant: correlated random walk with target bias, downward drift,
  hardness deflection, soft brush digging
- Pellet carrying to the surface and mound deposition with angle of repose
- Fixed 30 Hz sim with render interpolation
- Dev mode: time scale, density overlay, stats

Done when:
- Tunnel growth looks organic at 1× and 60×, with no grid artifacts
- Tunnels bend around rocks and clay differently for different seeds
- Tests: connectivity and soil conservation hold after a long run
- Determinism test passes

---

## M3. Movement, pathing, and many ants

**Goal:** calm, natural motion for a small crowd.

Scope:
- Distance field to the entrance (throttled recompute)
- A* with caching and invalidation; path smoothing
- Steering (seek, arrive, separation), speed variation, turn-rate cap
- Wall and floor hugging
- Tripod leg gait tied to speed
- 20 ants wandering and digging together

Done when:
- A 60-second recording or screenshot sequence shows no jitter, snapping, or
  overlapping ants
- Ants pass each other in tunnels gracefully
- Sim stays under budget with 70 ants (benchmark in dev stats)

---

## M4. Colony planner, seeded nests, and the camera

**Goal:** nests that are unique per seed and always shapely.

Scope:
- Planner: chamber types, needs thresholds, candidate scoring, dig job queue
- Main shaft, chambers budding off shafts, secondary shafts, rare connectors
- Chambers excavated from the connector side outward
- `advanceFocus(minutes)` in the debug API (temporarily driving growth by a
  population stub until M5)
- Camera: auto framing with a slow spring, drag and zoom, return to auto
- Dev overlays for chambers and jobs
- Screenshot gallery script (`npm run shots`)

Done when:
- Gallery of at least 6 seeds at a 2-hour-equivalent size: every nest looks
  different and every nest looks good
- Tests: no chamber overlap, no digging in edge margins or rock
- Camera movement is not noticeable at 1×

---

## M5. Lifecycle, roles, and focus-linked growth

**Goal:** the colony's story, driven by focus time.

Scope:
- Queen founding sequence (glide, land, shed wings, dig, settle)
- Eggs, larvae, pupae, nanitic and regular workers
- Roles: diggers, nurses, foragers, idlers; role rebalancing; the lazy
  majority
- Nursery brood sorting, granary food stacking, surface food spawning
- Pacing curve and nest size target from SPEC section 2
- Two clocks (`realTime`, `focusTime`), with a stub focus clock toggled from dev
  mode
- Resting behavior when focus is paused

Done when:
- Minute 2 of a fresh session has something pleasant to watch
- Pacing test passes at 25, 60, and 120 minutes
- Pausing visibly calms the colony within a few seconds; resuming restarts it
- Screenshots at 0, 10, 25 minutes and 2 hours for 3 seeds

---

## M6. Timer, UI, and returning to the tab

**Goal:** the real focus tool.

Scope:
- Focus clock from timestamps; open-ended and pomodoro modes
- Controls, task name field, settings panel with persistence
- Idle fade, keyboard shortcuts, fullscreen
- Tab title updates
- Session summary with stats (no Save picture — scoped out during this
  milestone, not wanted for v1)
- Catch-up mode with the "While you were away" time-lapse; benchmark it (move
  sim to a Web Worker only if the budget can't be met)
- Rendering stops while hidden

Done when:
- Playwright smoke test covers start, pause, resume, pomodoro transition, and
  end session
- Hiding the tab for a simulated hour, then returning, catches up in under
  about 10 seconds with a smooth time-lapse
- Keyboard-only use works; focus is visible
- UI copy follows the style rules in CLAUDE.md

---

## M7. Day and night

**Goal:** a living sky.

Scope:
- Compressed (12, 24, 48 min) and real-time modes
- Keyframe blending for sky and scene light; underground dimming rules
- Sun and moon arcs, star fade and slow twinkle, fireflies
- Night activity reduction

Done when:
- A 24-step screenshot strip across one compressed day shows smooth, pleasing
  transitions with no abrupt jumps
- The colony stays visible and the timer stays legible at night

---

## M8. Rain

**Goal:** gentle weather.

Scope:
- Seeded weather schedule (pure function of seed and time)
- Clouds, rain streaks, splashes, puddles and ripples
- Soil moisture front, darkening and drying
- Foragers sheltering, entrance plug and unplug
- Post-rain mushrooms

Done when:
- Screenshots of clouding, rain, and clearing at day and night
- Rain feels soft, not stormy; reduced-motion variant looks good
- Particle counts stay within budget

---

## M9. Small surprises

**Goal:** occasional moments of delight.

Scope:
- Surprise scheduler (seeded, weighted by time and weather, one at a time)
- Earthworm, beetle, butterfly, snail, falling leaf, extra fireflies, root
  growth
- Light ant reactions
- Dev triggers for each

Done when:
- Each surprise can be triggered from dev mode and looks at home in the art
  style
- Over a 2-hour accelerated run, surprises feel occasional, never busy

---

## M10. Sound

**Goal:** a gentle, ambient soundscape.

Scope:
- Tone.js audio engine that starts on the first Start click
- Layers from SPEC section 9, driven by weather, time of day, and dig activity
- Optional birdsong samples loaded only if present in `public/audio/`
- Settings: master volume, nature sounds, music, mute
- Fades of at least 3 seconds; master limiter

Done when:
- No clicks, pops, or sudden changes when toggling layers or when weather and
  time of day change
- Listening test at 60× shows smooth transitions (Ben reviews by ear)

---

## M11. Polish, performance, accessibility

**Goal:** ready to leave open all day.

Scope:
- Performance pass against the budgets in SPEC section 10, including the 30 fps
  battery saver
- Reduced-motion audit
- Contrast audit at all times of day
- Phone and tablet layout pass
- Final visual critique pass using the screenshot gallery
- README with a short description, the live link, and how to run locally

Done when:
- A 3-hour accelerated run shows no memory growth and stays within budgets
- Ben signs off on the full experience
