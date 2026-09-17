import { Application } from 'pixi.js';
import { readSession } from './app/session';
import { mountDevPanel } from './dev/devPanel';
import { createScene } from './render/scene';
import './theme/typography';
import './ui/styles.css';

async function main(): Promise<void> {
  const session = readSession();

  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, backgroundAlpha: 0 });

  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) {
    throw new Error('missing #app container in index.html');
  }
  container.appendChild(app.canvas);

  const scene = createScene(app);
  window.addEventListener('resize', () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  if (session.devMode) {
    mountDevPanel(session.seed);
  }
}

void main();
