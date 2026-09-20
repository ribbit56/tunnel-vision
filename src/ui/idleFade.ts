// Idle fade (SPEC section 8: "the UI fades out after 4 seconds without
// mouse or keyboard activity and fades back in on any input. The timer
// digits stay visible at reduced opacity; everything else hides"). Purely a
// CSS class toggle driven by real elapsed time — the actual fade transition
// is CSS (see styles.css), so this module only tracks idleness.
export interface IdleFadeConfig {
  idleSeconds: number;
}

export interface IdleFade {
  /** Call every frame with real elapsed seconds (CLAUDE.md "Two clocks" —
   * idleness is a `realTime` concern, unaffected by focus running or dev
   * time scale). */
  update(deltaSeconds: number): void;
  /** SPEC: "While the timer runs, the UI fades out..." — implying it never
   * fades otherwise. The caller skips `update` while the timer isn't
   * running and calls this instead, so the HUD stays fully visible before a
   * session starts or while paused. */
  reset(): void;
}

const FADE_CLASS = 'ui-idle';

/** Elements that stay visible (at reduced opacity, via CSS) while idle —
 * SPEC: "the timer digits stay visible... everything else hides." Marked
 * with a class rather than passed in individually, so any future addition
 * just needs the same class, not a code change here. */
const KEEP_VISIBLE_CLASS = 'idle-visible';

export function mountIdleFade(hud: HTMLElement, cfg: IdleFadeConfig): IdleFade {
  let secondsSinceActivity = 0;

  const markActive = () => {
    secondsSinceActivity = 0;
    hud.classList.remove(FADE_CLASS);
  };

  // Pointer movement, clicks, and key presses are all "activity" (SPEC:
  // "fades back in on any input"); scroll/drag on the canvas also count
  // since they're real interaction, just not aimed at the HUD itself.
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(type, markActive, { passive: true });
  }

  return {
    update(deltaSeconds: number): void {
      secondsSinceActivity += deltaSeconds;
      if (secondsSinceActivity >= cfg.idleSeconds) {
        hud.classList.add(FADE_CLASS);
      }
    },
    reset(): void {
      secondsSinceActivity = 0;
      hud.classList.remove(FADE_CLASS);
    },
  };
}

export { FADE_CLASS as IDLE_FADE_CLASS, KEEP_VISIBLE_CLASS };
