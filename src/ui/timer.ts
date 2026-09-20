// The timer display (SPEC section 8 "Layout"/"Behavior"): a big Alegreya
// readout over a soft backdrop, plus the editable task name. The actual
// value comes from `src/timer/focusClock.ts` each frame — this module only
// owns the DOM and formatting, never a clock of its own (CLAUDE.md "Timers
// come from timestamps").
export interface TimerUI {
  /** The editable task-name field — read from directly (its `textContent`)
   * for the tab title and session summary/save-picture caption. */
  taskNameEl: HTMLDivElement;
  setText(text: string): void;
}

export function mountTimer(hud: HTMLElement): TimerUI {
  const wrap = document.createElement('div');
  wrap.id = 'timer-wrap';

  const backdrop = document.createElement('div');
  backdrop.id = 'timer-backdrop';
  wrap.appendChild(backdrop);

  const timer = document.createElement('div');
  timer.id = 'timer';
  timer.textContent = '0:00';
  wrap.appendChild(timer);

  const taskName = document.createElement('div');
  taskName.id = 'task-name';
  taskName.contentEditable = 'true';
  taskName.dataset.placeholder = 'What are you focusing on?';
  wrap.appendChild(taskName);

  hud.appendChild(wrap);

  return {
    taskNameEl: taskName,
    setText(text: string): void {
      timer.textContent = text;
    },
  };
}
