// Dev-mode panel (SPEC section 11), enabled with ?dev=1: the time-of-day
// slider from M1, plus M2's time scale, density overlay, and a small stats
// readout. Overlays for the planner/paths and the full debug API arrive with
// the milestones that need them.
import type { MainLoop } from '../app/mainLoop';
import type { SurpriseKind } from '../environment/surprises';
import type { WeatherPhase } from '../environment/weather';
import type { Scene } from '../render/scene';
import type { Simulation } from '../sim/sim';
import { computeColonyStats, type SimStats } from './colonyStats';

export { createSimStats, computeColonyStats, type SimStats, type ColonyStats } from './colonyStats';

const TIME_SCALES = [1, 10, 60, 300];
const WEATHER_PHASES: WeatherPhase[] = ['clear', 'clouding', 'rain', 'clearing'];
const SURPRISE_KINDS: SurpriseKind[] = ['earthworm', 'beetle', 'butterfly', 'snail', 'fallingLeaf', 'extraFireflies'];

export function mountDevPanel(
  seed: string,
  scene: Scene,
  mainLoop: MainLoop,
  sim: Simulation,
  simStats: SimStats,
  runAdvanceFocus: (minutes: number) => void,
  toggleFocus: () => void,
  onForceHour: (hours: number) => void,
  onForceWeather: (phase: WeatherPhase | null) => void,
  onTriggerSurprise: (kind: SurpriseKind) => void,
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
    onForceHour(hours);
    const h = Math.floor(hours) % 24;
    const m = Math.round((hours - Math.floor(hours)) * 60);
    hourReadout.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });
  details.appendChild(hourSlider);

  // SPEC section 11 "force weather state" — "auto" clears the override and
  // lets the seeded schedule (`environment/weather.ts`) run normally again.
  const weatherRow = document.createElement('div');
  weatherRow.style.marginTop = '6px';
  weatherRow.append('weather ');
  const autoButton = document.createElement('button');
  autoButton.type = 'button';
  autoButton.textContent = 'auto';
  autoButton.style.marginLeft = '4px';
  autoButton.addEventListener('click', () => onForceWeather(null));
  weatherRow.appendChild(autoButton);
  for (const phase of WEATHER_PHASES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = phase;
    button.style.marginLeft = '4px';
    button.addEventListener('click', () => onForceWeather(phase));
    weatherRow.appendChild(button);
  }
  details.appendChild(weatherRow);

  // SPEC section 11 "trigger any surprise" — one-shot previews, not a
  // standing override (see main.ts's `devForcedSurprise` handling).
  const surpriseRow = document.createElement('div');
  surpriseRow.style.marginTop = '6px';
  surpriseRow.append('surprise ');
  for (const kind of SURPRISE_KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = kind;
    button.style.marginLeft = '4px';
    button.addEventListener('click', () => onTriggerSurprise(kind));
    surpriseRow.appendChild(button);
  }
  // Root growth (SPEC's one "Continuous" surprise, so it has no start/stop
  // to trigger) gets a fast-forward instead, to preview an otherwise
  // hours-long change without waiting.
  const rootsButton = document.createElement('button');
  rootsButton.type = 'button';
  rootsButton.textContent = 'grow roots +1h';
  rootsButton.style.marginLeft = '4px';
  rootsButton.addEventListener('click', () => scene.fastForwardRoots(3600));
  surpriseRow.appendChild(rootsButton);
  details.appendChild(surpriseRow);

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

  const plannerRow = document.createElement('label');
  plannerRow.style.display = 'block';
  plannerRow.style.marginTop = '6px';
  const plannerCheckbox = document.createElement('input');
  plannerCheckbox.type = 'checkbox';
  plannerCheckbox.addEventListener('change', () => {
    scene.setPlannerOverlayVisible(plannerCheckbox.checked);
  });
  plannerRow.append(plannerCheckbox, ' chambers/jobs overlay');
  details.appendChild(plannerRow);

  const advanceRow = document.createElement('div');
  advanceRow.style.marginTop = '6px';
  advanceRow.append('jump focus ');
  for (const minutes of [5, 30, 120]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `+${minutes}m`;
    button.style.marginLeft = '4px';
    button.addEventListener('click', () => runAdvanceFocus(minutes));
    advanceRow.appendChild(button);
  }
  details.appendChild(advanceRow);

  // A dev-only convenience toggle — calls the exact same start/pause logic
  // as the real Start focusing/Pause control in the HUD (`ui/controls.ts`),
  // just faster to reach while poking around in dev mode. `sim.focusRunning`
  // is derived from the real focus clock every frame now (M6), so flipping
  // it directly here would just get overwritten on the next tick.
  const focusRow = document.createElement('div');
  focusRow.style.marginTop = '6px';
  const focusToggle = document.createElement('button');
  focusToggle.type = 'button';
  focusToggle.addEventListener('click', toggleFocus);
  focusRow.appendChild(focusToggle);
  details.appendChild(focusRow);

  const stats = document.createElement('div');
  stats.style.marginTop = '6px';
  stats.style.whiteSpace = 'pre';
  details.appendChild(stats);

  setInterval(() => {
    focusToggle.textContent = sim.focusRunning ? 'pause focus' : 'resume focus';

    const s = computeColonyStats(sim, simStats);
    stats.textContent = [
      `focus: ${s.focusMinutes.toFixed(1)} min (${s.focusRunning ? 'running' : 'paused'})`,
      `ants: ${s.antCount} — digger ${s.roleCounts.digger}, nurse ${s.roleCounts.nurse}, forager ${s.roleCounts.forager}, idler ${s.roleCounts.idler}`,
      `fps: ${s.fps.toFixed(0)}`,
      `sim step: ${s.lastStepMs.toFixed(2)} ms (avg ${s.avgStepMs.toFixed(2)} ms) — budget 2ms`,
      `render: ${s.lastRenderMs.toFixed(2)} ms (avg ${s.avgRenderMs.toFixed(2)} ms) — budget 4ms`,
      `open cells: ${s.openCells.toFixed(0)} / target ${s.targetOpenCells.toFixed(0)}`,
      `chambers: ${s.chambers}, shafts: ${s.shafts}, jobs queued: ${s.jobsQueued}`,
      `brood: ${s.brood}, mound: ${s.moundCells.toFixed(1)} cells, granary: ${s.granaryStored}`,
      `weather: ${s.weatherPhase} (intensity ${s.rainIntensity.toFixed(2)}), entrance plugged: ${s.entrancePlugged}`,
      `surprise: ${s.activeSurprise ?? 'none'}`,
    ].join('\n');
  }, 250);

  document.body.appendChild(details);
}
