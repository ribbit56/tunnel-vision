import { Application } from 'pixi.js';
import { createMainLoop } from './app/mainLoop';
import { readSession } from './app/session';
import { layout } from './config';
import { mountDevPanel } from './dev/devPanel';
import { createScene } from './render/scene';
import { createSimulation, stepSimulation } from './sim/sim';
import { mergeDirty, type DirtyRect } from './sim/world';
import './theme/typography';
import { mountControls } from './ui/controls';
import './ui/styles.css';
import { mountTimer } from './ui/timer';

// Sim runs at a fixed 30 Hz; rendering interpolates between ticks (SPEC
// section 10, CLAUDE.md "Fixed timestep simulation").
const FIXED_DT = 1 / 30;

async function main(): Promise<void> {
  const session = readSession();
  const sim = createSimulation(session.seed);

  const app = new Application();
  // The tunnel filter only ships a WebGL program (SPEC's rendering technique
  // is written in terms of a WebGL fragment shader); force that renderer so
  // it doesn't silently no-op on a browser that would otherwise pick WebGPU.
  await app.init({ preference: 'webgl', resizeTo: window, antialias: true, backgroundAlpha: 0 });

  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) {
    throw new Error('missing #app container in index.html');
  }
  container.appendChild(app.canvas);

  const scene = createScene(app, session.seed, sim.world);
  window.addEventListener('resize', () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // Sim steps accumulate a dirty rect each tick; a render frame that ran
  // several ticks (high dev time scale) repaints once with their union.
  let pendingDirty: DirtyRect | null = null;
  const mainLoop = createMainLoop(FIXED_DT, {
    step: (dt) => {
      const result = stepSimulation(sim, dt);
      pendingDirty = mergeDirty(pendingDirty, result.dirty);
    },
    render: (alpha) => {
      scene.syncFromSim(sim, pendingDirty);
      pendingDirty = null;
      scene.renderInterpolated(sim, alpha);
    },
  });

  // Shared with #timer-wrap's CSS height so the UI and the render camera
  // agree on where the sky ends without hard-coding the fraction twice.
  document.documentElement.style.setProperty('--sky-fraction', String(layout.skyFraction));

  const hud = document.createElement('div');
  hud.id = 'hud';
  document.body.appendChild(hud);
  mountTimer(hud);
  mountControls(hud);

  app.ticker.add((ticker) => {
    const deltaSeconds = ticker.deltaMS / 1000;
    mainLoop.frame(deltaSeconds);
    scene.updateEnvironment(deltaSeconds);
  });

  if (session.devMode) {
    mountDevPanel(session.seed, scene, mainLoop, sim);
  }
}

void main();
