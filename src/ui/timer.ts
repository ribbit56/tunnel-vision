// Static timer display for M1's art-direction lock (SPEC section 8). Not
// wired to a real clock yet — that's src/timer/focusClock.ts in M6.
export function mountTimer(hud: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.id = 'timer-wrap';

  const backdrop = document.createElement('div');
  backdrop.id = 'timer-backdrop';
  wrap.appendChild(backdrop);

  const timer = document.createElement('div');
  timer.id = 'timer';
  timer.textContent = '25:00';
  wrap.appendChild(timer);

  const taskName = document.createElement('div');
  taskName.id = 'task-name';
  taskName.contentEditable = 'true';
  taskName.dataset.placeholder = 'What are you focusing on?';
  wrap.appendChild(taskName);

  hud.appendChild(wrap);
}
