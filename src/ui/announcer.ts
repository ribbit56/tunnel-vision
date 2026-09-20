// A screen-reader-only announcement region (SPEC section 10: "The timer is
// not an aria-live region (no per-second announcements); pomodoro
// transitions are announced once"). Visually hidden — this exists purely
// for assistive tech, never seen on screen.
export interface Announcer {
  /** Replaces the announcement text, so screen readers read it once. */
  announce(message: string): void;
}

export function mountAnnouncer(hud: HTMLElement): Announcer {
  const el = document.createElement('div');
  el.id = 'sr-announcer';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('role', 'status');
  hud.appendChild(el);

  return {
    announce(message: string): void {
      el.textContent = message;
    },
  };
}
