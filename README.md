# Tunnel Vision

A calm focus timer for the browser. While you focus, a seeded colony of ants
digs a nest in a cross-section of soil beneath a storybook sky — the colony
only grows while the timer runs, so by the end of a session the nest is a
visible record of the focus you put in. Days turn to night, rain comes and
goes, and small creatures occasionally pass through. Every seed grows a
different colony.

**Live:** https://ribbit56.github.io/tunnel-vision/

## Running locally

```
npm install
npm run dev
```

Open the printed local URL. Add `?seed=<any text>` to reproduce a specific
colony, or `?dev=1` for a small dev panel (jump focus time forward, force the
time of day or weather, trigger surprises, and a few debug overlays).

## Other commands

```
npm run build     # production build to dist/
npm run preview   # serve the production build locally
npm test          # simulation unit tests (vitest)
npm run e2e       # smoke tests (playwright)
npm run shots     # screenshot gallery into screenshots/ (git-ignored)
npm run lint
```

## More

See [`docs/SPEC.md`](docs/SPEC.md) for the full design and technical spec, and
[`docs/MILESTONES.md`](docs/MILESTONES.md) for the build order this project
followed. `CLAUDE.md` documents the architecture rules (simulation/rendering
separation, deterministic seeded randomness, the color palette) for anyone
working on the code.
