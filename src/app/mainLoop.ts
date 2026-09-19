// Fixed-timestep accumulator loop (CLAUDE.md "Fixed timestep simulation...
// with render interpolation"). Driven by real elapsed seconds each frame
// (never by counting frames), so it behaves the same at 30fps or 144fps.
export interface MainLoopCallbacks {
  step: (fixedDt: number) => void;
  render: (alpha: number) => void;
}

export interface MainLoop {
  /** Call once per animation frame with the real elapsed seconds. */
  frame(realDeltaSeconds: number): void;
  setTimeScale(scale: number): void;
  getTimeScale(): number;
}

// Caps how much sim time one real frame can catch up, so a stalled tab
// (or a very high dev time scale) can't freeze the page trying to simulate
// hours of missed time in one go. Proper catch-up mode arrives in M6.
const MAX_STEPS_PER_FRAME = 240;

export function createMainLoop(fixedDt: number, callbacks: MainLoopCallbacks): MainLoop {
  let accumulator = 0;
  let timeScale = 1;

  return {
    frame(realDeltaSeconds: number): void {
      const scaled = Math.min(realDeltaSeconds, 0.25) * timeScale;
      accumulator += scaled;

      let steps = 0;
      while (accumulator >= fixedDt && steps < MAX_STEPS_PER_FRAME) {
        callbacks.step(fixedDt);
        accumulator -= fixedDt;
        steps++;
      }

      callbacks.render(accumulator / fixedDt);
    },
    setTimeScale(scale: number): void {
      timeScale = scale;
    },
    getTimeScale(): number {
      return timeScale;
    },
  };
}
