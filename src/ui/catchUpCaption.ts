// The brief caption shown during catch-up mode (SPEC section 8: "shown as a
// brief time-lapse with a small caption, 'While you were away, the colony
// kept digging.'").
export interface CatchUpCaption {
  show(): void;
  hide(): void;
}

export function mountCatchUpCaption(hud: HTMLElement): CatchUpCaption {
  const caption = document.createElement('div');
  caption.id = 'catch-up-caption';
  caption.textContent = 'While you were away, the colony kept digging.';
  hud.appendChild(caption);

  return {
    show: () => caption.classList.add('visible'),
    hide: () => caption.classList.remove('visible'),
  };
}
