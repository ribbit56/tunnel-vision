import { Application } from 'pixi.js';
import { createMainLoop } from './app/mainLoop';
import { readSession } from './app/session';
import { loadSettings, resolveReducedMotion, saveSettings, type Settings } from './app/settings';
import {
  catchUp as catchUpConfig,
  dayNight as dayNightConfig,
  layout,
  pomodoro as pomodoroConfig,
  surprises as surprisesConfig,
  weather as weatherConfig,
  world as worldConfig,
} from './config';
import { createSimStats, mountDevPanel } from './dev/devPanel';
import { computeHourOfDay, nightFactorForHour } from './environment/dayNight';
import { computeSurpriseState, surfaceWalkerX, type SurpriseKind, type SurpriseState } from './environment/surprises';
import { computeWeatherState, type WeatherPhase } from './environment/weather';
import { createScene } from './render/scene';
import { advanceFocus, createSimulation, stepSimulation } from './sim/sim';
import { mergeDirty, type DirtyRect } from './sim/world';
import { startCatchUp, stepCatchUp, type CatchUpRun } from './timer/catchUp';
import {
  createFocusClock,
  displayMs,
  formatDuration,
  pauseClock,
  startClock,
  tickPomodoro,
  totalElapsedMs,
  type FocusMode,
} from './timer/focusClock';
import './theme/typography';
import { mountAnnouncer } from './ui/announcer';
import { mountCatchUpCaption } from './ui/catchUpCaption';
import { mountControls } from './ui/controls';
import { mountIdleFade } from './ui/idleFade';
import { mountKeyboardShortcuts } from './ui/keyboard';
import { mountSessionSummary, type SessionStats } from './ui/sessionSummary';
import { mountSettingsPanel } from './ui/settingsPanel';
import './ui/styles.css';
import { mountTimer } from './ui/timer';
import { idleFade as idleFadeConfig } from './config';
import { ui as uiPalette } from './theme/palette';

// Sim runs at a fixed 30 Hz; rendering interpolates between ticks (SPEC
// section 10, CLAUDE.md "Fixed timestep simulation").
const FIXED_DT = 1 / 30;

/** Builds a URL to a fresh colony, preserving `?dev=1` if present (SPEC:
 * "start a new colony with a new seed or a pasted seed"). `seed: null` means
 * random — `session.ts`'s own `readSession` already knows how to generate
 * one when the param is absent. */
function newColonyUrl(seed: string | null, devMode: boolean): string {
  const params = new URLSearchParams();
  if (seed) params.set('seed', seed);
  if (devMode) params.set('dev', '1');
  const query = params.toString();
  return query.length > 0 ? `${window.location.pathname}?${query}` : window.location.pathname;
}

async function main(): Promise<void> {
  const session = readSession();
  const settings = loadSettings();
  const sim = createSimulation(session.seed);
  const focusClock = createFocusClock(settings.focusMode);
  let everStarted = false;
  // SPEC section 6: compressed mode's day cycle is measured from when the
  // session began, not from a fixed epoch — CLAUDE.md "environment state is
  // a pure function of seed and time," so this alone (plus the current
  // timestamp) is all `computeHourOfDay` ever needs, no matter how long the
  // tab sits hidden in between.
  const sessionStartMs = Date.now();
  // SPEC section 11 "force time of day (slider)" — set by the dev panel,
  // this overrides the real computation below until the page reloads.
  let devForcedHour: number | null = null;
  // SPEC section 11 "force weather state" — same idea, for rain.
  let devForcedWeather: WeatherPhase | null = null;
  // SPEC section 11 "trigger any surprise" — same idea, for small surprises.
  // Unlike the weather/hour overrides (which hold steady until changed),
  // this is a one-shot preview: it plays out for that kind's own configured
  // duration and then hands back to the real schedule on its own.
  let devForcedSurprise: SurpriseKind | null = null;
  let devForcedSurpriseStartMs = 0;

  const app = new Application();
  // The tunnel filter only ships a WebGL program (SPEC's rendering technique
  // is written in terms of a WebGL fragment shader); force that renderer so
  // it doesn't silently no-op on a browser that would otherwise pick WebGPU.
  await app.init({ preference: 'webgl', resizeTo: window, antialias: true, backgroundAlpha: 0 });
  app.ticker.maxFPS = settings.frameRate;

  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container) {
    throw new Error('missing #app container in index.html');
  }
  container.appendChild(app.canvas);

  const scene = createScene(app, session.seed, sim.world);
  scene.setReducedMotion(resolveReducedMotion(settings.reducedMotion));
  window.addEventListener('resize', () => {
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // Sim steps accumulate a dirty rect each tick; a render frame that ran
  // several ticks (high dev time scale) repaints once with their union.
  let pendingDirty: DirtyRect | null = null;
  let lastFrameDeltaSeconds = 0;
  const simStats = createSimStats();
  const mainLoop = createMainLoop(FIXED_DT, {
    // performance.now() deliberately, not Date.now() — this measures real
    // compute cost for the dev-stats readout, which needs sub-millisecond
    // precision and no relation to session/wall-clock time. The focus
    // clock and catch-up-trigger timestamps below use Date.now() instead,
    // since that's what test tooling (e.g. Playwright's Clock) can mock.
    step: (dt) => {
      const before = performance.now();
      const result = stepSimulation(sim, dt);
      simStats.lastStepMs = performance.now() - before;
      // A slow-moving average, not a fixed-window one — cheap, and plenty
      // stable enough for an eyeballed dev-stats readout.
      simStats.avgStepMs += (simStats.lastStepMs - simStats.avgStepMs) * 0.05;
      pendingDirty = mergeDirty(pendingDirty, result.dirty);
    },
    render: (alpha) => {
      const before = performance.now();
      scene.syncFromSim(sim, pendingDirty);
      pendingDirty = null;
      scene.renderInterpolated(sim, alpha, lastFrameDeltaSeconds);
      simStats.lastRenderMs = performance.now() - before;
      simStats.avgRenderMs += (simStats.lastRenderMs - simStats.avgRenderMs) * 0.05;
    },
  });

  // Shared with #timer-wrap's CSS height so the UI and the render camera
  // agree on where the sky ends without hard-coding the fraction twice.
  document.documentElement.style.setProperty('--sky-fraction', String(layout.skyFraction));
  // A handful of colors new UI (settings/summary panels) needs, exposed as
  // CSS custom properties (CLAUDE.md "Palette values live only in
  // src/theme/palette.ts") — the existing HUD elements predate this and
  // still hard-code their own colors in styles.css.
  document.documentElement.style.setProperty('--text-on-sky', uiPalette.textOnSky);
  document.documentElement.style.setProperty('--text-on-panel', uiPalette.textOnPanel);
  document.documentElement.style.setProperty('--honey-accent', uiPalette.honeyAccent);
  document.documentElement.style.setProperty('--panel-background', uiPalette.panelBackground);

  const hud = document.createElement('div');
  hud.id = 'hud';
  document.body.appendChild(hud);
  const timerUI = mountTimer(hud);
  const catchUpCaption = mountCatchUpCaption(hud);
  const announcer = mountAnnouncer(hud);

  function currentTaskName(): string {
    return timerUI.taskNameEl.textContent?.trim() ?? '';
  }

  function collectStats(nowMs: number): SessionStats {
    return {
      focusedMs: totalElapsedMs(focusClock, nowMs),
      workers: sim.ants.filter((ant) => ant.role !== 'queen').length,
      broodCount: sim.lifecycle.brood.length,
      chambersCount: sim.planner.chambers.length,
      pelletsCarried: sim.mound.totalDeposited,
      seed: session.seed,
    };
  }

  const sessionSummary = mountSessionSummary(hud, {
    onStartNewColony: () => {
      window.location.href = newColonyUrl(null, session.devMode);
    },
    onKeepWatching: () => sessionSummary.hide(),
  });

  function toggleFocus(): void {
    const now = Date.now();
    if (focusClock.running) {
      pauseClock(focusClock, now);
    } else {
      startClock(focusClock, now);
      everStarted = true;
    }
    controlsUI.setRunning(focusClock.running, everStarted, focusClock.mode, focusClock.phase);
  }

  const controlsUI = mountControls(hud, settings.focusMode, {
    onToggle: toggleFocus,
    onModeChange: (mode: FocusMode) => {
      focusClock.mode = mode;
      settings.focusMode = mode;
      saveSettings(settings);
      controlsUI.setRunning(focusClock.running, everStarted, focusClock.mode, focusClock.phase);
    },
    onEndSession: () => {
      pauseClock(focusClock, Date.now());
      controlsUI.setRunning(focusClock.running, everStarted, focusClock.mode, focusClock.phase);
      sessionSummary.show(collectStats(Date.now()));
    },
  });

  function applySettingsSideEffects(next: Settings): void {
    app.ticker.maxFPS = next.frameRate;
    scene.setReducedMotion(resolveReducedMotion(next.reducedMotion));
  }

  const settingsPanel = mountSettingsPanel(hud, session.seed, settings, {
    onFrameRateChange: (rate) => {
      settings.frameRate = rate;
      saveSettings(settings);
      applySettingsSideEffects(settings);
    },
    onReducedMotionChange: (value) => {
      settings.reducedMotion = value;
      saveSettings(settings);
      applySettingsSideEffects(settings);
    },
    onDayNightModeChange: (mode) => {
      settings.dayNightMode = mode;
      saveSettings(settings);
    },
    onCompressedCycleChange: (minutes) => {
      settings.compressedCycleMinutes = minutes;
      saveSettings(settings);
    },
    onNewColony: (seed) => {
      window.location.href = newColonyUrl(seed, session.devMode);
    },
  });

  const idleFade = mountIdleFade(hud, idleFadeConfig);

  mountKeyboardShortcuts({
    toggleFocus,
    toggleFullscreen: () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen().catch(() => {
          // Fullscreen can be denied (no user gesture, iframe restrictions,
          // browser support) — the shortcut just silently does nothing.
        });
      }
    },
    toggleSettings: () => settingsPanel.toggle(),
    closePanels: () => {
      settingsPanel.close();
      if (sessionSummary.isOpen()) sessionSummary.hide();
    },
  });

  // Catch-up mode (SPEC "Returning to a hidden tab"): the tab going hidden
  // doesn't pause the focus clock — it's still "running" the whole time the
  // user is away, same as if they'd left it running in the foreground. What
  // actually stops is rendering and sim stepping, per CLAUDE.md/SPEC section
  // 10 ("stop rendering when the tab is hidden... the sim is caught up on
  // return"), since neither can do anything useful while nothing can be
  // seen anyway.
  let hiddenSinceMs: number | null = null;
  let catchUpRun: CatchUpRun | null = null;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      app.ticker.stop();
      if (focusClock.running) hiddenSinceMs = Date.now();
    } else {
      app.ticker.start();
      if (hiddenSinceMs !== null) {
        const missedMinutes = (Date.now() - hiddenSinceMs) / 60_000;
        hiddenSinceMs = null;
        const run = startCatchUp(missedMinutes, catchUpConfig, FIXED_DT);
        if (!run.done) {
          catchUpRun = run;
          catchUpCaption.show();
        }
      }
    }
  });

  app.ticker.add((ticker) => {
    const nowMs = Date.now();
    const deltaSeconds = ticker.deltaMS / 1000;
    // A slow-moving average, like the sim/render timings above — a raw
    // instantaneous 1000/deltaMS reading jitters too much frame to frame to
    // read at a glance.
    if (deltaSeconds > 0) simStats.fps += (1 / deltaSeconds - simStats.fps) * 0.1;

    // Resolved before stepping the sim this frame (not after) — otherwise a
    // pause/resume or a pomodoro phase change would take an extra tick to
    // actually reach the colony, since `stepSimulation` reads this flag.
    const transition = tickPomodoro(focusClock, nowMs, pomodoroConfig);
    if (transition) {
      // SPEC: "Pomodoro transitions play a soft chime" — arrives with M10's
      // audio system; the button label and colony resting/growing already
      // update correctly without it.
      controlsUI.setRunning(focusClock.running, everStarted, focusClock.mode, focusClock.phase);
      // SPEC section 10: "pomodoro transitions are announced once" — a
      // screen-reader-only announcement, independent of the (not yet built)
      // audio chime above.
      announcer.announce(
        transition.transitionedTo === 'break'
          ? focusClock.currentBreakIsLong
            ? 'Long break started'
            : 'Break started'
          : 'Focus started',
      );
    }
    sim.focusRunning = focusClock.running && (focusClock.mode === 'open-ended' || focusClock.phase === 'focus');

    // SPEC section 6: time of day is a pure function of mode/cycle/session
    // start/now — it never needs catching up, and it keeps advancing on
    // realTime regardless of whether focus is running (CLAUDE.md "Two
    // clocks": the environment "keeps living on realTime regardless").
    const hours =
      devForcedHour ??
      computeHourOfDay(
        settings.dayNightMode,
        { compressedCycleMinutes: settings.compressedCycleMinutes, sessionStartHour: dayNightConfig.sessionStartHour },
        sessionStartMs,
        nowMs,
      );
    sim.nightFactor = nightFactorForHour(hours);

    // SPEC section 6 "Rain": also a pure function of seed and real time, so
    // it never needs catching up — same treatment as time of day above. A
    // forced phase from the dev panel substitutes a fixed representative
    // intensity rather than trying to fake a whole schedule around it.
    const weatherState =
      devForcedWeather === null
        ? computeWeatherState(session.seed, weatherConfig, sessionStartMs, nowMs)
        : { phase: devForcedWeather, phaseProgress: 0, intensity: { clear: 0, clouding: 0.5, rain: 1, clearing: 0.5 }[devForcedWeather] };
    sim.weatherPhase = weatherState.phase;
    sim.rainIntensity = weatherState.intensity;
    scene.setWeather(weatherState);

    // SPEC section 6 "Small surprises": same pure-function-of-time treatment
    // as weather above. A dev-triggered preview plays out for that kind's
    // own max configured duration, then falls back to the real schedule.
    let surpriseState: SurpriseState;
    if (devForcedSurprise !== null) {
      const elapsed = (nowMs - devForcedSurpriseStartMs) / 1000;
      const durationSeconds = surprisesConfig.durationSecondsByKind[devForcedSurprise][1];
      if (elapsed >= durationSeconds) {
        devForcedSurprise = null;
        surpriseState = computeSurpriseState(session.seed, surprisesConfig, settings.dayNightMode, { compressedCycleMinutes: settings.compressedCycleMinutes, sessionStartHour: dayNightConfig.sessionStartHour }, weatherConfig, sessionStartMs, nowMs);
      } else {
        surpriseState = { active: devForcedSurprise, instanceId: -2, elapsedSeconds: elapsed, durationSeconds };
      }
    } else {
      surpriseState = computeSurpriseState(session.seed, surprisesConfig, settings.dayNightMode, { compressedCycleMinutes: settings.compressedCycleMinutes, sessionStartHour: dayNightConfig.sessionStartHour }, weatherConfig, sessionStartMs, nowMs);
    }
    scene.setSurprise(surpriseState);
    sim.activeSurprise = surpriseState.active;
    // SPEC: "surface ants pause as a beetle passes" — the sim only needs to
    // know where, and only while a beetle specifically is what's active.
    sim.surfaceSurpriseX =
      surpriseState.active === 'beetle'
        ? surfaceWalkerX(session.seed, surpriseState.instanceId, surpriseState.elapsedSeconds, surprisesConfig.beetleSpeed, worldConfig.gridW * worldConfig.cellSize)
        : null;

    if (catchUpRun) {
      const done = stepCatchUp(catchUpRun, sim, FIXED_DT, catchUpConfig.msBudgetPerFrame, () => performance.now());
      scene.syncFromSim(sim, { minX: 0, minY: 0, maxX: sim.world.gridW - 1, maxY: sim.world.gridH - 1 });
      scene.renderInterpolated(sim, 1, deltaSeconds);
      if (done) {
        catchUpRun = null;
        catchUpCaption.hide();
      }
    } else {
      lastFrameDeltaSeconds = deltaSeconds;
      mainLoop.frame(deltaSeconds);
    }

    timerUI.setText(formatDuration(displayMs(focusClock, nowMs, pomodoroConfig)));
    document.title = focusClock.running
      ? `${formatDuration(displayMs(focusClock, nowMs, pomodoroConfig))} ${currentTaskName()}`.trim()
      : everStarted
        ? `Paused ${formatDuration(displayMs(focusClock, nowMs, pomodoroConfig))}`
        : 'Tunnel Vision';

    scene.setTimeOfDay(hours);
    scene.updateEnvironment(deltaSeconds);
    scene.updateCamera(sim, deltaSeconds);

    if (focusClock.running) {
      idleFade.update(deltaSeconds);
    } else {
      idleFade.reset();
    }
  });

  // Hidden tabs get their title updated far less often than a visible one's
  // ticker fires (SPEC: "hidden tabs update the title at whatever rate the
  // browser allows; show minutes only when the tab is hidden") — a plain
  // interval independent of the ticker covers that case.
  setInterval(() => {
    if (!document.hidden) return;
    const now = Date.now();
    document.title = focusClock.running
      ? `${formatDuration(displayMs(focusClock, now, pomodoroConfig), true)} ${currentTaskName()}`.trim()
      : document.title;
  }, 15_000);

  if (session.devMode) {
    // advanceFocus steps the sim directly, well outside the main loop's own
    // dirty-rect accumulator above — without a full resync afterward, the
    // tunnel mask texture would keep showing whatever it looked like right
    // before the jump, since it only ever repaints the sub-rectangles a
    // normal frame-by-frame dirty rect names. Deliberately left as an
    // instant, synchronous jump rather than routed through catch-up mode
    // (SPEC section 11's parenthetical) — instant is more useful for
    // development and the whole screenshot-gallery test suite depends on
    // it resolving synchronously; real catch-up mode above is what actually
    // matters for the hidden-tab user flow.
    const runAdvanceFocus = (minutes: number): void => {
      advanceFocus(sim, minutes);
      scene.syncFromSim(sim, { minX: 0, minY: 0, maxX: sim.world.gridW - 1, maxY: sim.world.gridH - 1 });
    };
    mountDevPanel(
      session.seed,
      scene,
      mainLoop,
      sim,
      simStats,
      runAdvanceFocus,
      toggleFocus,
      (hours) => {
        devForcedHour = hours;
      },
      (weather) => {
        devForcedWeather = weather;
      },
      (kind) => {
        devForcedSurprise = kind;
        devForcedSurpriseStartMs = Date.now();
      },
    );
  }
}

main().catch((err: unknown) => {
  console.error('main() failed:', err);
});
