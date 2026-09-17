# Tunnel Vision: design and technical spec

Working title. Owner: Ben. Target: static web app on GitHub Pages.

## 1. Vision

A calm place to focus. The top of the screen is a soft storybook sky holding a
large, quiet timer. Below the grass line is a cross-section of warm, layered
soil. When the user starts focusing, a winged queen drifts down, sheds her
wings, and digs a small founding chamber. She lays eggs, the brood matures into
workers, and the workers dig a nest of shafts and chambers, carrying soil up to
a mound that slowly grows beside the entrance.

The colony only grows while the timer runs. At the end of a session, the nest
and the mound are a visible picture of the focus the user put in, and they can
save that picture.

Every session is unique (seeded), but always pretty (rules keep the nest
shapely). The world around the colony lives on its own: days turn to night, rain
comes and goes, and small creatures occasionally pass through.

### Design principles

1. **Calm over busy.** Low speeds, soft easing, few simultaneous events.
2. **Growth you can see.** The nest and mound should read clearly as "what I
   built this session."
3. **Unique but shapely.** Randomness lives inside rules that guarantee a
   good-looking nest.
4. **One memorable thing.** The colony cross-section is the hero. The UI is
   quiet and gets out of the way.
5. **Kind to the machine.** People will leave this open for hours.

## 2. Session model and pacing

### Focus-linked growth

- The **focus clock** accumulates time only while the timer is running.
- Colony growth systems (planner, digging, lifecycle, egg laying) advance on
  `focusTime`.
- When paused (or during a pomodoro break), ants finish their current small
  action, then rest: slow walking toward the nearest chamber, idle antenna
  twitches, occasional grooming. The queen rests. Brood does not mature.
- The environment (sky, day/night, weather, grass sway, surprises) keeps
  living on `realTime` regardless.
- Each page load is a fresh colony with a new random seed, unless `?seed=` is
  given. The seed is shown in settings with a copy button.

### Pacing curve

Growth is fast at first and slows logarithmically, so a 25-minute session is
satisfying and a 3-hour session doesn't overflow the world.

Target worker count (a *target*, not an instant value; actual workers lag
because brood takes time to mature):

```
t          = focused minutes
t_found    = 6            # founding period, queen alone
tau        = 30           # curve softness
T_mature   = 120          # "mature" colony at 2 focused hours
W_mature   = 50
W_cap      = 70

t' = max(0, t - t_found)
targetWorkers(t) = min(W_cap, W_mature * ln(1 + t'/tau) / ln(1 + (T_mature - t_found)/tau))
```

Approximate targets:

| Focused time | Target workers |
|---|---|
| 5 min | 0 (queen alone) |
| 10 min | 4 |
| 15 min | 8 |
| 25 min | 16 |
| 45 min | 27 |
| 60 min | 33 |
| 90 min | 43 |
| 2 h | 50 |
| 3 h | 61 |
| 4 h+ | 70 (cap) |

Nest size tracks population (real ant nests scale their volume with worker
count):

```
targetOpenCells = foundingCells + CELLS_PER_WORKER * (workers + 0.5 * brood)
CELLS_PER_WORKER = 90   # tune for "lots of tunnels" without clutter
```

All of these constants live in `src/config.ts`.

### Founding timeline (focused time)

| Time | Event |
|---|---|
| 0:00 | Winged queen drifts down from the sky in a gentle, slightly wandering glide (about 15 s) |
| 0:15 | Lands, walks a little, sheds wings (wings flutter to the ground and fade) |
| 0:30 | Begins digging the entrance and a short founding shaft |
| ~2:30 | Founding chamber complete; she settles in |
| ~3:00 | First eggs (3 to 5) |
| ~5:00 | Eggs become larvae |
| ~7:00 | Larvae become pupae |
| ~8:30 | First small workers (nanitics, 80% size) emerge and take over digging |
| after | Queen stays in the royal chamber and lays eggs as the planner requests |

Brood stage durations are config values. Egg laying rate is driven by the gap
between `targetWorkers` and (workers + brood).

## 3. World

### Coordinates

- World units are "world pixels." y = 0 is the grass line; negative y is sky,
  positive y is soil.
- Soil grid: `GRID_W = 400`, `GRID_H = 300`, `CELL = 4` world px, so soil is
  1600 × 1200 world px.
- Sky extends 520 world px above the surface.
- Worker ant length about 9 px (just over 2 cells). Queen about 15 px.
- Tunnels are 4 to 5 cells wide so two ants can pass. Chambers are 18 to 40
  cells wide and 6 to 10 cells tall.

### Terrain grid (`src/sim/world.ts`)

Per cell, stored in typed arrays:

- `density` (Float32, 0 = open, 1 = solid). Digging lowers density gradually,
  which gives the renderer a smooth field.
- `hardness` (Float32, 0..1) from seeded noise plus strata. Harder soil digs
  slower and deflects tunnels.
- `material` (Uint8): topsoil, loam, sand band, clay, subsoil, deep, rock.
  Rock cells are undiggable.
- `moisture` (Float32, 0..1), updated by weather.

Plus a surface **height map** (per column) for the mound and small terrain
undulation.

### Strata generation (seeded)

- Five to six horizontal bands, boundaries warped with low-frequency noise so
  they undulate.
- Band thicknesses vary per seed within ranges.
- A clay lens or two (harder), a sand band (softer).
- Scattered rocks of varying size (undiggable, rounded shapes).
- Pebbles (cosmetic, drawn into the soil texture).
- Roots descend from grass clumps and any small plants; roots slowly lengthen
  during the session (cosmetic, but tunnels avoid root cells).

### Invariants (tested)

- Every open cell is connected to the entrance. Ants never create sealed voids.
- Soil is conserved: cells removed underground ≈ soil added to the mound (within
  a tolerance for pellet rounding).
- No digging closer than 12 cells to the world's left, right, or bottom edge.

## 4. Colony planner (`src/sim/colony/planner.ts`)

The planner decides *what* to dig. Ants decide *how*.

### Structure it aims for

Inspired by plaster casts of real nests (Walter Tschinkel, *Ant Architecture*):

- One main shaft descending from the entrance, with gentle lean and optional
  slow spiral tendency (seeded).
- Horizontal, pancake-shaped chambers budding off the sides of shafts.
- Chambers larger and more numerous near the top, sparser and smaller deeper.
- As the colony grows, secondary shafts branch off chambers or the main shaft
  and descend on their own.
- Occasional short connecting tunnels between nearby chambers (loops make it
  feel alive, but keep them rare).

### Chamber types

| Type | Placement | Notes |
|---|---|---|
| Royal | Mid depth (about 25 to 40% of max depth reached so far), first chamber dug | Queen lives here |
| Nursery | Upper to mid depth | Eggs, larvae, pupae sorted by stage within it |
| Granary | Deeper | Seeds and crumbs stacked neatly |
| Resting | Any depth | Where idle workers gather |

A new chamber is requested when a need crosses a threshold: brood count exceeds
nursery capacity, stored food exceeds granary capacity, idle workers exceed
resting capacity, or `openCells` falls behind `targetOpenCells`.

### Placement rules

- Candidate sites are sampled along existing shafts (seeded), then scored:
  - depth band fit for the chamber type,
  - minimum spacing from other chambers (at least 8 cells vertical, 6
    horizontal clearance),
  - no rock within the chamber footprint plus margin,
  - prefers softer soil,
  - prefers alternating sides of a shaft,
  - small random jitter so ties break differently per seed.
- Chamber shape: a flattened ellipse (width 3 to 5× height) with a flatter
  floor and domed ceiling, edges perturbed with noise. Stored as a target mask.
- When shafts reach a depth where no good sites remain, the planner extends a
  shaft or starts a secondary shaft.

### Dig jobs

The planner emits a priority queue of **dig jobs**:

- `ShaftSegment { from, heading, length, width }`
- `Connector { fromCell, toChamberId }`
- `Chamber { id, type, mask }`

Jobs are claimed by digger ants. A chamber job is excavated from the side
nearest its connector outward, so chambers visibly "open up."

## 5. Ants

### Roles

- **Queen**: founding sequence, then lays eggs in the royal chamber.
- **Diggers**: claim dig jobs, dig, carry pellets to the surface.
- **Nurses**: carry eggs and brood from the royal chamber to the nursery, sort
  brood by stage, tend it.
- **Foragers**: walk the surface, pick up seeds and crumbs, bring them to the
  granary.
- **Idlers**: loiter in resting chambers, groom, wander a little.

Role mix is recomputed every few seconds from colony needs. Following real
colonies, a minority of workers (about 30%) does most of the digging while
many others idle. That loitering reads as peaceful, so keep it.

### Behavior (`src/sim/ants/`)

Each ant has a small state machine, for example for a digger:

```
idle -> goToDigFace -> dig -> carryPellet -> goToSurface -> depositPellet -> return
```

Other states: `goToTarget`, `pickUp`, `carry`, `drop`, `rest`, `groom`,
`shelter` (rain), `plugEntrance`, `unplugEntrance`, `forage`.

### Digging (the "how")

At the dig face, the ant advances with a **correlated random walk**:

- heading = previous heading + small noise (seeded),
- plus a steering bias toward the job's target,
- plus a slight downward drift for shaft jobs,
- movement cost scaled by `hardness`; high hardness nudges the heading away, so
  tunnels bend around clay and rocks differently every time.

Each dig action lowers `density` inside a soft circular brush (radius about 1.5
cells) and produces one soil pellet. A pellet represents about 3 cells of soil.

### Mound

- Diggers exit the entrance and drop pellets within a short distance.
- Deposits add to the surface height map and settle with an angle-of-repose
  rule (spread to neighbors if slope exceeds the limit), giving a natural
  crater-and-mound shape.
- Fresh pellets are slightly lighter in color and blend in over a minute.

### Movement and pathing

- Ants move only through open cells and along the surface.
- A **distance field** from the entrance (BFS over open cells) is recomputed at
  most once per second when terrain changes. Ants heading up follow it.
- For other targets, A* over open cells, with results cached per target and
  invalidated on nearby terrain changes.
- Paths are smoothed (Catmull-Rom or string-pulling) and followed with gentle
  steering (seek, arrive, and light separation so ants don't overlap).
- Ants hug tunnel floors and walls slightly rather than floating in the middle.
- Speeds (world px/s): worker 18 to 26 (each ant gets its own), queen 10,
  carrying 80% of normal. Turning rate is capped. No instant turns.
- Leg gait: a simple tripod gait animation whose cycle rate matches speed.

## 6. Environment

### Day and night

Two modes, chosen in settings:

- **Compressed** (default): a full day cycle every 24 minutes (options 12, 24,
  48). Sessions start at mid-morning.
- **Real time**: follows the user's local clock.

Time of day is a pure function of mode, cycle length, session start, and
current real time.

Visuals:

- Sky gradient and scene light blend between four keyframes (palette section).
- The sun and moon travel on soft arcs behind the timer's area but never
  directly behind the digits.
- Stars fade in at dusk with a very slow, subtle twinkle (no flicker).
- Fireflies drift over the grass at night (a handful, slow glow pulses).
- Underground is lit with storybook license: it dims with the scene but never
  goes fully dark, so the colony stays visible at night.
- Colony activity at night is reduced (movement speed × 0.8, fewer foragers,
  more resting).

### Rain

Weather is a seeded schedule, a pure function of seed and real time:

- `clear -> clouding (60 to 90 s) -> rain (4 to 8 min) -> clearing (90 s) -> clear`
- First rain no earlier than 15 minutes into the session; mean gap about 45
  minutes. Light or medium rain only. No thunder.

Effects:

- Clouds drift in on two parallax layers and soften the light.
- Raindrops are short, soft streaks at a slight angle; small splash particles at
  the grass line; gentle ripples in puddles that form in surface dips.
- A moisture front descends from the surface into the soil (per-column value
  that diffuses downward slowly). Wet soil darkens. It dries over about 10
  minutes after rain ends.
- Foragers head home when clouds arrive. Once it rains, one worker may plug the
  entrance with a pellet and unplug it after the rain ends.
- After rain, a few small mushrooms may sprout on the surface (seeded chance),
  and fade over 10 to 15 minutes.

### Small surprises

A seeded schedule triggers one surprise every 6 to 12 minutes of real time, at
most one active at a time, weighted by time of day and weather:

| Surprise | When | What happens |
|---|---|---|
| Earthworm | Any, more likely after rain | Slowly passes through the soil on its own path; soil closes behind it; never breaks into ant tunnels |
| Beetle | Day | Trundles across the surface, pauses, leaves |
| Butterfly | Day, dusk | Flutters across the sky, may alight on a flower |
| Snail | After rain | Crosses the surface very slowly |
| Falling leaf | Any | Drifts down and rests on the grass, fades later |
| Fireflies (extra) | Night | A slightly bigger drift of fireflies |
| Root growth | Continuous | Roots lengthen almost imperceptibly |

Ants react lightly (for example, surface ants pause as a beetle passes).

## 7. Art direction: warm storybook

### Look

Warm, earthy, gently textured, like an illustration in a picture book. Soft
shapes, no hard outlines, a subtle paper grain across everything. Colors are
muted and warm. Nothing is saturated or harsh.

### Palette (`src/theme/palette.ts`)

Time-of-day keyframes (blend smoothly between them):

| Keyframe | Clock | Sky top | Sky horizon | Light tint | Exposure |
|---|---|---|---|---|---|
| Dawn | 06:00 | `#C9A9B8` | `#F4D3A8` | `#FFE4C4` | 0.90 |
| Day | 12:00 | `#A9CFD8` | `#EEE7CF` | `#FFF8EC` | 1.00 |
| Dusk | 18:30 | `#8C7BA6` | `#EDA774` | `#F6C79A` | 0.85 |
| Night | 00:00 | `#1E2640` | `#3C4868` | `#9AA8D0` | 0.55 |

Surface:

| Name | Hex |
|---|---|
| Grass light | `#9BB36A` |
| Grass mid | `#7A9A52` |
| Grass dark | `#5C7A42` |
| Flower accents | `#E8C27A`, `#D98C7A`, `#F3EAD6` |
| Mound (settled) | `#A07B58` |
| Mound (fresh pellet) | `#B89270` |

Soil strata, top to bottom:

| Band | Hex |
|---|---|
| Topsoil | `#5E4232` |
| Loam | `#7A5A40` |
| Sand band | `#B8936A` |
| Clay | `#A0664A` |
| Subsoil | `#6B4A38` |
| Deep | `#4A3428` |
| Rock | `#8A8078` |
| Pebbles | `#9C8B7A`, `#C2B29E` |
| Roots | `#D8C3A0` |

Tunnels:

| Name | Hex |
|---|---|
| Tunnel interior | `#2B1E17` |
| Tunnel rim (edge darkening) | `#22170F` |
| Tunnel floor highlight | `#6E4F38` |
| Wet soil multiply | `#5A4A48` at up to 35% |

Creatures and objects:

| Name | Hex |
|---|---|
| Worker body | `#2E211C` |
| Worker highlight | `#5A4036` |
| Queen body | `#3A2620` |
| Queen abdomen band | `#7A4A2A` |
| Queen wings | `#EEF2F2` at 60% alpha |
| Egg | `#F6EFDD` |
| Larva | `#F0E4C6` |
| Pupa | `#E4CFA3` |
| Seed | `#D6A45C` |
| Crumb | `#E7C98F` |
| Firefly glow | `#F7E48A` |
| Stars | `#FDF6E3` |

UI:

| Name | Value |
|---|---|
| Text on sky | `#FFF8EC` |
| Text on panels (light theme panels) | `#3B2A20` |
| Honey accent | `#E3A857` |
| Panel background | `rgba(59, 42, 32, 0.55)` with backdrop blur |

Global: a paper grain texture over the whole scene at about 5% (multiply), and
a very soft vignette.

Soil should also dim gradually with depth (about 25% darker at the bottom),
independent of time of day.

### Tunnel rendering (the key technique)

Never draw the grid as blocks.

1. Keep a **mask texture** at grid resolution (400 × 300, one texel per cell)
   holding `1 - density`. Update only dirty regions when terrain changes.
2. Sample it with bilinear filtering (optionally a small blur) in a custom
   fragment shader over the soil layer.
3. In the shader:
   - `open = smoothstep(0.45, 0.55, mask)` gives a soft organic edge.
   - A second, slightly wider threshold band gives the darker **rim**.
   - Compare the mask above and below the fragment to find floors; add the
     lighter **floor highlight** where open space sits above solid soil.
   - Add a faint noise wobble to the threshold so edges look hand-drawn.
   - Blend tunnel interior color with a hint of the surrounding stratum color
     so tunnels don't look like holes punched to black.
4. Fallback if the shader approach fails: marching squares on the density
   field, drawn as smooth filled paths.

### Soil texture

Generated once per seed into a render texture: warped strata bands, fine grain
speckle, pebbles, rocks, and roots. Moisture darkening and depth dimming are
applied in the shader, not baked.

### Ants and brood

- Ants: three soft ellipses (head, thorax, abdomen), thin legs and antennae as
  lines with rounded caps. At this scale, suggestion beats detail.
- A gentle 1 px darker underside and a faint highlight on the abdomen.
- Carried items sit in the mandibles, ahead of the head.
- Brood are soft pale ovals; larvae are slightly curved; pupae slightly larger
  with a faint segment line.

### Surface

- Grass: layered tufts with slow, per-tuft wind sway (phase offset by
  position, amplitude tied to weather).
- A few small flowers and one or two small plants whose roots feed the root
  system.
- The entrance: a small dark opening with a crater rim from the mound.

### Camera

- Starts framed on the lower sky (with room for the timer) and the top of the
  soil.
- As the nest deepens, the camera eases to keep the whole nest plus the surface
  in view, zooming out down to a minimum scale of 0.6. Below that, it pans
  instead.
- Camera changes use a critically damped spring with a time constant of about 60
  to 120 seconds. The user should never notice it moving.
- The user can drag to pan and scroll to zoom. After 20 seconds without input,
  the camera eases back to auto framing.

## 8. Timer and UI

### Layout

```
+--------------------------------------------------------------+
|                                                    (gear)    |
|                                                              |
|                         1:24:07                              |
|                What are you focusing on?                     |
|                  [ Pause ]   [ End session ]                 |
|        ~ sky, clouds, sun/moon ~                             |
|~~~~~~~~~~~~~~~~ grass ~~~~~ mound ~~~~~~~~~~~~~~~~~~~~~~~~~~~|
|                                                              |
|             soil cross-section, colony below                |
|                                                              |
+--------------------------------------------------------------+
```

- The timer is centered in the sky, large (clamp around 64 to 120 px), set in
  **Alegreya** with lining tabular figures (`font-variant-numeric: lining-nums
  tabular-nums`) so digits don't shift.
- Controls and labels use **Alegreya Sans**.
- Timer text sits on a very soft radial backdrop so it stays legible at every
  time of day.
- The task name is an inline editable field with the placeholder
  "What are you focusing on?"
- Timer format: `m:ss` under an hour, `h:mm:ss` after.

### Controls

- Start focusing / Pause / Resume (one button, label reflects the action)
- End session (opens the summary)
- Mode: Open-ended (counts up) or Pomodoro (focus and break lengths,
  default 25 and 5, with a long break of 15 every 4 rounds)
- Settings panel (gear): day/night mode and cycle length, sound (master volume
  plus toggles for nature sounds and music), frame rate (smooth 60 or battery
  saver 30), reduced motion (follow system, on, off), seed (view, copy, start
  a new colony with a new seed or a pasted seed)

### Behavior

- Timer is computed from timestamps: `focused = sum(finished segments) + (now -
  segmentStart)` while running.
- While the timer runs, the UI fades out after 4 seconds without mouse or
  keyboard activity and fades back in on any input. The timer digits stay
  visible at reduced opacity; everything else hides.
- Keyboard: Space start/pause, F fullscreen, M mute, S settings, Esc close
  panels.
- The browser tab title shows the timer so users working in other tabs can see
  it: `25:13 Writing report` while running, `Paused 25:13` when paused. Hidden
  tabs update the title at whatever rate the browser allows; show minutes only
  when the tab is hidden.
- Pomodoro transitions play a soft chime and change the button label; during
  breaks the colony rests.
- Settings persist in `localStorage` (wrapped in try/catch). The colony itself
  is not persisted in v1.

### Session summary

On End session, a soft panel shows:

- focused time,
- workers, brood, chambers, soil carried (pellets),
- the seed,
- **Save picture**: exports a PNG of the full colony (render the whole world to
  an offscreen texture at 1x, with the task name and focused time set small in
  a corner),
- **Start a new colony** and **Keep watching**.

### Returning to a hidden tab

People will usually work in other tabs, so the tab will often be hidden while
the timer runs. Browsers throttle hidden tabs heavily.

- The timer is always correct because it uses timestamps.
- Environment state is recomputed directly from time (no catch-up needed).
- The colony catches up when the tab becomes visible: compute missed focus time
  and run the simulation in **catch-up mode**, spread across frames (budget
  about 8 ms of sim per frame), shown as a brief time-lapse with a small caption,
  "While you were away, the colony kept digging."
- Catch-up mode uses a coarser timestep and simplified movement (skip steering,
  advance along cached paths) so an hour of missed focus catches up in under
  about 10 seconds. Cap catch-up at 3 hours of focus time.
- Benchmark this in its milestone. If the main thread can't meet the budget,
  move the simulation into a Web Worker, passing state with transferable
  ArrayBuffers (not SharedArrayBuffer).

## 9. Sound

Everything is procedural first (no licensing issues, tiny download), using
Tone.js. All layers fade in and out over at least 3 seconds. A master limiter
keeps peaks soft. Audio starts only after the first Start click.

| Layer | When | How |
|---|---|---|
| Air bed | Always, very low | Brown/pink noise, low-pass filtered, slow LFO on cutoff |
| Rain | During rain, follows intensity | Filtered noise plus sparse soft droplet ticks, panned randomly |
| Crickets | Night | Sparse synthesized chirps (short high sine bursts with amplitude modulation), a few voices at different rates |
| Birdsong | Day, sparse | Optional CC0 samples in `public/audio/` (owner supplies them). If absent, skip this layer rather than using cheesy synthesized birds |
| Digging | While diggers are active | Very quiet granular soil crackle, density tied to dig rate |
| Music (optional) | Off by default | Slow generative pad: pentatonic notes, long attack and release, lots of reverb, a new note every 6 to 12 seconds |
| Chime | Pomodoro transitions | Soft FM bell, low volume |

Settings: master volume, nature sounds on/off, music on/off, mute (M).

Any sample files go in `public/audio/` with sources and licenses listed in
`public/audio/LICENSES.md`.

## 10. Performance and accessibility

- Sim runs at a fixed 30 Hz; rendering interpolates between sim states.
- Frame rate options: 60 (default) or 30 (battery saver).
- Stop rendering when the tab is hidden (`visibilitychange`); the sim is caught
  up on return.
- Budgets: up to 70 workers, about 150 brood items, pooled particles (max 400
  raindrops, 40 fireflies). Target under 4 ms render and under 2 ms sim per
  frame on a mid-range laptop.
- Update the tunnel mask texture only in dirty regions.
- `prefers-reduced-motion` (or the setting): no rain streaks (show a soft
  overall rain tint and puddle ripples only), no star twinkle, fewer particles,
  UI transitions become fades only, camera snaps between framings with a slow
  cross-fade instead of zooming.
- All controls are real buttons with labels and visible keyboard focus. The
  timer is not an `aria-live` region (no per-second announcements); pomodoro
  transitions are announced once.
- UI text meets WCAG AA contrast against its backdrop at every time of day.
- Layout works down to phone width (the sky area shrinks; the timer scales).

## 11. Dev mode

Enabled with `?dev=1`. A small collapsible panel:

- Time scale: 1×, 10×, 60×, 300×
- Jump focus time: +5 min, +30 min, +2 h (runs catch-up mode)
- Seed input and "regenerate"
- Force time of day (slider), force weather state, trigger any surprise
- Overlays: grid, density field, planner chambers and jobs, ant states and
  paths, distance field
- Stats: FPS, sim ms, render ms, ant counts by role, open cells vs target,
  pellets carried

A debug API on `window.__colony` (dev mode only) for Playwright:

```
setSeed(seed), setTimeScale(n), advanceFocus(minutes),
setTimeOfDay(hours), setWeather(state), triggerSurprise(name),
getStats(), getStateHash()
```

## 12. Testing

Vitest (`tests/`):

- Determinism: same seed and same focus timeline give the same `getStateHash()`
  after N ticks.
- Different seeds give different nest layouts.
- Invariants after long runs (several seeds, 3 h of focus): connectivity, soil
  conservation, no digging in edge margins, no chamber overlap, no digging
  through rock.
- Pacing: worker count follows the target curve within tolerance at 25, 60,
  and 120 minutes.
- Focus clock: pause/resume math, pomodoro transitions, hidden-tab gaps.

Playwright (`e2e/`):

- Smoke test: loads, starts, pauses, ends session, no console errors.
- `npm run shots`: screenshot gallery for 3 seeds × focus times (0, 10 min,
  25 min, 2 h) × times of day (dawn, day, dusk, night), plus rain. Written to
  `screenshots/` (git-ignored) for visual review, not strict pixel diffs.

## 13. Project structure

```
tunnel-vision/
  CLAUDE.md
  docs/
    SPEC.md
    MILESTONES.md
    reference/            mood-board images
  public/
    audio/                optional CC0 samples + LICENSES.md
    textures/             paper grain, etc.
  src/
    main.ts
    config.ts             tunable sim, pacing, timing constants
    app/                  bootstrap, main loop, visibility, catch-up, settings store
    sim/                  pure simulation (no DOM, no Pixi)
      rng.ts  noise.ts  world.ts  strata.ts  pacing.ts  sim.ts
      colony/             planner.ts  lifecycle.ts  roles.ts
      ants/               agent.ts  behaviors.ts  steering.ts  pathing.ts  digging.ts
      surface/            mound.ts  food.ts
      env/                dayNight.ts  weather.ts  moisture.ts  surprises.ts
    render/               Pixi scene
      scene.ts  camera.ts  sky.ts  surface.ts  soil.ts  tunnels.ts
      tunnels.frag  ants.ts  brood.ts  weather.ts  creatures.ts
      lighting.ts  particles.ts  snapshot.ts
    audio/                engine.ts and one file per layer
    timer/                focusClock.ts  pomodoro.ts
    ui/                   timer.ts  controls.ts  settings.ts  summary.ts  idleFade.ts  styles.css
    theme/                palette.ts  typography.ts
    dev/                  devPanel.ts  debugApi.ts  overlays.ts
  tests/
  e2e/
  .github/workflows/deploy.yml
```

## 14. Deployment

- GitHub Actions workflow on push to `main`: install, test, build with
  `BASE_PATH=/<repo-name>/`, upload `dist/`, deploy with the official Pages
  actions (`actions/upload-pages-artifact` and `actions/deploy-pages`).
- Repository setting: Pages source is "GitHub Actions."
- All asset URLs must respect Vite's `base`.

## 15. Later ideas (not in v1)

- Persist the colony between sessions (IndexedDB) and grow it over days.
- Colony gallery of saved pictures.
- Installable PWA with offline support.
- Seasons (autumn leaves, winter slowdown).
- Share a seed link.
- Alates (winged ants) leaving on a mature colony's nuptial flight.
