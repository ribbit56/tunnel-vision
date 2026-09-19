// Dev-mode panel (SPEC section 11), enabled with ?dev=1. M1 only needs the
// time-of-day slider so the four sky keyframes can be checked and compared;
// later milestones add time scale, overlays, and stats here.
import type { Scene } from '../render/scene';

export function mountDevPanel(seed: string, scene: Scene): void {
  const details = document.createElement('details');
  details.id = 'dev-panel';
  details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'Dev';
  details.appendChild(summary);

  const seedLine = document.createElement('div');
  seedLine.textContent = `seed: ${seed}`;
  details.appendChild(seedLine);

  const label = document.createElement('label');
  label.style.display = 'block';
  label.style.marginTop = '6px';
  const hourReadout = document.createElement('span');
  hourReadout.textContent = '12:00';
  label.append('time of day ', hourReadout);
  details.appendChild(label);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '24';
  slider.step = '0.1';
  slider.value = '12';
  slider.style.width = '160px';
  slider.addEventListener('input', () => {
    const hours = Number(slider.value);
    scene.sky.setHour(hours);
    const h = Math.floor(hours) % 24;
    const m = Math.round((hours - Math.floor(hours)) * 60);
    hourReadout.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });
  details.appendChild(slider);

  document.body.appendChild(details);
}
