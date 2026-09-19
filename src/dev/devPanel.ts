// Dev-mode panel (SPEC section 11), enabled with ?dev=1: the time-of-day
// slider from M1, plus M2's time scale, density overlay, and a small stats
// readout. Overlays for the planner/paths and the full debug API arrive with
// the milestones that need them.
import type { MainLoop } from '../app/mainLoop';
import type { Scene } from '../render/scene';
import { totalVolumeDug } from '../sim/world';
import type { Simulation } from '../sim/sim';

const TIME_SCALES = [1, 10, 60, 300];

export function mountDevPanel(
  seed: string,
  scene: Scene,
  mainLoop: MainLoop,
  sim: Simulation,
): void {
  const details = document.createElement('details');
  details.id = 'dev-panel';
  details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'Dev';
  details.appendChild(summary);

  const seedLine = document.createElement('div');
  seedLine.textContent = `seed: ${seed}`;
  details.appendChild(seedLine);

  const timeOfDayLabel = document.createElement('label');
  timeOfDayLabel.style.display = 'block';
  timeOfDayLabel.style.marginTop = '6px';
  const hourReadout = document.createElement('span');
  hourReadout.textContent = '12:00';
  timeOfDayLabel.append('time of day ', hourReadout);
  details.appendChild(timeOfDayLabel);

  const hourSlider = document.createElement('input');
  hourSlider.type = 'range';
  hourSlider.min = '0';
  hourSlider.max = '24';
  hourSlider.step = '0.1';
  hourSlider.value = '12';
  hourSlider.style.width = '160px';
  hourSlider.addEventListener('input', () => {
    const hours = Number(hourSlider.value);
    scene.sky.setHour(hours);
    const h = Math.floor(hours) % 24;
    const m = Math.round((hours - Math.floor(hours)) * 60);
    hourReadout.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });
  details.appendChild(hourSlider);

  const timeScaleRow = document.createElement('div');
  timeScaleRow.style.marginTop = '6px';
  timeScaleRow.append('time scale ');
  for (const scale of TIME_SCALES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${scale}x`;
    button.style.marginLeft = '4px';
    button.addEventListener('click', () => mainLoop.setTimeScale(scale));
    timeScaleRow.appendChild(button);
  }
  details.appendChild(timeScaleRow);

  const densityRow = document.createElement('label');
  densityRow.style.display = 'block';
  densityRow.style.marginTop = '6px';
  const densityCheckbox = document.createElement('input');
  densityCheckbox.type = 'checkbox';
  densityCheckbox.addEventListener('change', () => {
    scene.setDensityOverlayVisible(densityCheckbox.checked);
  });
  densityRow.append(densityCheckbox, ' density overlay');
  details.appendChild(densityRow);

  const stats = document.createElement('div');
  stats.style.marginTop = '6px';
  stats.style.whiteSpace = 'pre';
  details.appendChild(stats);
  setInterval(() => {
    stats.textContent = [
      `phase: ${sim.digger.phase}`,
      `dug: ${totalVolumeDug(sim.world).toFixed(1)} cells`,
      `mound: ${sim.mound.totalDeposited.toFixed(1)} cells`,
    ].join('\n');
  }, 250);

  document.body.appendChild(details);
}
