// Static controls for M1's art-direction lock (SPEC section 8): the
// start/pause button, end session, and the settings gear. Not wired to
// anything yet — that lands in M6 alongside the real focus clock.
export function mountControls(hud: HTMLElement): void {
  const gear = document.createElement('button');
  gear.id = 'settings-gear';
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Settings');
  gear.textContent = '⚙';
  hud.appendChild(gear);

  const timerWrap = hud.querySelector<HTMLDivElement>('#timer-wrap');
  const controls = document.createElement('div');
  controls.id = 'controls';

  const startButton = document.createElement('button');
  startButton.id = 'btn-start';
  startButton.type = 'button';
  startButton.textContent = 'Start focusing';
  controls.appendChild(startButton);

  const endButton = document.createElement('button');
  endButton.id = 'btn-end';
  endButton.type = 'button';
  endButton.textContent = 'End session';
  controls.appendChild(endButton);

  (timerWrap ?? hud).appendChild(controls);
}
