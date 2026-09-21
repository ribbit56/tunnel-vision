// The brief caption shown during catch-up mode (SPEC section 8: "shown as a
// brief time-lapse with a small caption, 'While you were away, the colony
// kept digging.'"). A real catch-up run can currently take well longer than
// SPEC's own "brief" framing intends (see config.ts's `catchUp` comment) —
// a bare static sentence for that whole stretch reads as stuck rather than
// working, so it also carries a quiet, ticking-up progress percentage.
export interface CatchUpCaption {
  show(): void;
  hide(): void;
  /** `fraction` 0 to 1 through the current run. */
  setProgress(fraction: number): void;
}

const BASE_TEXT = 'While you were away, the colony kept digging.';

export function mountCatchUpCaption(hud: HTMLElement): CatchUpCaption {
  const caption = document.createElement('div');
  caption.id = 'catch-up-caption';
  caption.textContent = BASE_TEXT;
  hud.appendChild(caption);

  return {
    show: () => caption.classList.add('visible'),
    hide: () => caption.classList.remove('visible'),
    setProgress(fraction: number): void {
      const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      caption.textContent = `${BASE_TEXT} (${percent}%)`;
    },
  };
}
