// Keyboard shortcuts (SPEC section 8: "Space start/pause, F fullscreen, M
// mute, S settings, Esc close panels"). M mute is skipped for now — there's
// no audio system yet (that's M10) and nothing meaningful to mute.
export interface KeyboardActions {
  toggleFocus(): void;
  toggleFullscreen(): void;
  toggleSettings(): void;
  closePanels(): void;
}

/** Ignores keystrokes while the user is typing somewhere (the task-name
 * field, a text input in the settings panel) — Space/F/S/Esc should only act
 * as shortcuts when nothing is capturing text input. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export function mountKeyboardShortcuts(actions: KeyboardActions): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault(); // stop the page from scrolling on Space
        actions.toggleFocus();
        break;
      case 'f':
      case 'F':
        actions.toggleFullscreen();
        break;
      case 's':
      case 'S':
        actions.toggleSettings();
        break;
      case 'Escape':
        actions.closePanels();
        break;
    }
  });
}
