import { Application } from 'pixi.js';
import { readSession } from './app/session';
import { layout } from './config';
import { mountDevPanel } from './dev/devPanel';
import { createScene } from './render/scene';
import './theme/typography';
import { mountControls } from './ui/controls';
import './ui/styles.css';
import { mountTimer } from './ui/timer';

async function main(): Promise<void> {
  const session = readSession();

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

  const scene = createScene(app, session.seed);
  window.addEventListener('resize', () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS / 1000);
  });

  // Shared with #timer-wrap's CSS height so the UI and the render camera
  // agree on where the sky ends without hard-coding the fraction twice.
  document.documentElement.style.setProperty('--sky-fraction', String(layout.skyFraction));

  const hud = document.createElement('div');
  hud.id = 'hud';
  document.body.appendChild(hud);
  mountTimer(hud);
  mountControls(hud);

  if (session.devMode) {
    mountDevPanel(session.seed, scene);
  }
}

void main();
