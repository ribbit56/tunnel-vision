// Start/Pause/Resume, mode toggle, and End session controls (SPEC section 8
// "Controls"). The gear/settings button lives in `settingsPanel.ts` instead —
// tightly coupled to the panel it opens, not to these session controls.
import type { FocusMode, PomodoroPhase } from '../timer/focusClock';

export interface ControlsActions {
  onToggle(): void;
  onModeChange(mode: FocusMode): void;
  onEndSession(): void;
}

export interface ControlsUI {
  /** Reflects the current running/paused state in the button label (SPEC:
   * "one button, label reflects the action"), and — in pomodoro mode — the
   * current phase too (SPEC: "transitions... change the button label"). */
  setRunning(running: boolean, everStarted: boolean, mode: FocusMode, phase: PomodoroPhase): void;
}

export function mountControls(hud: HTMLElement, initialMode: FocusMode, actions: ControlsActions): ControlsUI {
  const timerWrap = hud.querySelector<HTMLDivElement>('#timer-wrap');
  const controls = document.createElement('div');
  controls.id = 'controls';

  const startButton = document.createElement('button');
  startButton.id = 'btn-start';
  startButton.type = 'button';
  startButton.textContent = 'Start focusing';
  startButton.addEventListener('click', () => actions.onToggle());
  controls.appendChild(startButton);

  const endButton = document.createElement('button');
  endButton.id = 'btn-end';
  endButton.type = 'button';
  endButton.textContent = 'End session';
  endButton.addEventListener('click', () => actions.onEndSession());
  controls.appendChild(endButton);

  const modeRow = document.createElement('div');
  modeRow.id = 'mode-toggle';
  const openEndedLabel = document.createElement('label');
  const openEndedRadio = document.createElement('input');
  openEndedRadio.type = 'radio';
  openEndedRadio.name = 'focus-mode';
  openEndedRadio.checked = initialMode === 'open-ended';
  openEndedRadio.addEventListener('change', () => {
    if (openEndedRadio.checked) actions.onModeChange('open-ended');
  });
  openEndedLabel.append(openEndedRadio, 'Open-ended');

  const pomodoroLabel = document.createElement('label');
  const pomodoroRadio = document.createElement('input');
  pomodoroRadio.type = 'radio';
  pomodoroRadio.name = 'focus-mode';
  pomodoroRadio.checked = initialMode === 'pomodoro';
  pomodoroRadio.addEventListener('change', () => {
    if (pomodoroRadio.checked) actions.onModeChange('pomodoro');
  });
  pomodoroLabel.append(pomodoroRadio, 'Pomodoro');

  modeRow.append(openEndedLabel, pomodoroLabel);
  controls.appendChild(modeRow);

  (timerWrap ?? hud).appendChild(controls);

  return {
    setRunning(running: boolean, everStarted: boolean, mode: FocusMode, phase: PomodoroPhase): void {
      const onBreak = mode === 'pomodoro' && phase === 'break';
      if (running) {
        // "Pause" alone reads fine regardless of phase — pausing is pausing.
        startButton.textContent = 'Pause';
      } else {
        startButton.textContent = !everStarted ? 'Start focusing' : onBreak ? 'Resume break' : 'Resume focusing';
      }
    },
  };
}
