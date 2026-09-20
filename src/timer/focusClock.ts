// The real focus clock (SPEC section 8 "Behavior"): "computed from
// timestamps: focused = sum(finished segments) + (now - segmentStart) while
// running." Deliberately outside src/sim/ (CLAUDE.md keeps the sim pure of
// wall-clock reads) but just as deliberately pure itself — every function
// here takes the caller's own `nowMs` rather than reading Date.now() or
// performance.now() directly, so pause/resume math and pomodoro transitions
// are exercised in tests the same way the sim's own determinism tests are:
// by feeding in timestamps, not by waiting on a real clock.
export type FocusMode = 'open-ended' | 'pomodoro';
export type PomodoroPhase = 'focus' | 'break';

export interface PomodoroConfig {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** SPEC: "a long break of 15 every 4 rounds." */
  roundsBeforeLongBreak: number;
}

export interface FocusClock {
  mode: FocusMode;
  /** Always 'focus' in open-ended mode — there's no break phase to enter. */
  phase: PomodoroPhase;
  running: boolean;
  /** Completed focus rounds this session (pomodoro only; drives the long-break cadence). */
  roundsCompleted: number;
  /** True while the *current* break should be the long one — decided the moment a focus round finishes, so a still-running break doesn't need to re-derive it from `roundsCompleted` on every tick. */
  currentBreakIsLong: boolean;
  /** Finished-segment ms banked in the current phase; resets on every pomodoro phase transition, but not otherwise. */
  phaseAccumulatedMs: number;
  /** Finished-segment ms banked for the whole session — never resets except by creating a new clock. This is what drives `sim.focusMinutes` and the session summary, since colony growth cares about total focused time, not which pomodoro phase produced it. */
  totalFocusedMs: number;
  /** Timestamp the current running segment began, or null while paused. */
  segmentStartMs: number | null;
}

export function createFocusClock(mode: FocusMode): FocusClock {
  return {
    mode,
    phase: 'focus',
    running: false,
    roundsCompleted: 0,
    currentBreakIsLong: false,
    phaseAccumulatedMs: 0,
    totalFocusedMs: 0,
    segmentStartMs: null,
  };
}

/** Folds the currently-open segment (if any) into both accumulators and
 * restarts it from `nowMs` — used both when actually pausing (the caller
 * then also clears `segmentStartMs`) and mid-run at a pomodoro phase
 * boundary, where the clock keeps running straight through the transition. */
function foldSegment(clock: FocusClock, nowMs: number): void {
  if (clock.segmentStartMs === null) return;
  const elapsed = nowMs - clock.segmentStartMs;
  clock.phaseAccumulatedMs += elapsed;
  clock.totalFocusedMs += elapsed;
  clock.segmentStartMs = nowMs;
}

export function startClock(clock: FocusClock, nowMs: number): void {
  if (clock.running) return;
  clock.running = true;
  clock.segmentStartMs = nowMs;
}

export function pauseClock(clock: FocusClock, nowMs: number): void {
  if (!clock.running) return;
  foldSegment(clock, nowMs);
  clock.segmentStartMs = null;
  clock.running = false;
}

export function phaseElapsedMs(clock: FocusClock, nowMs: number): number {
  const open = clock.segmentStartMs !== null ? nowMs - clock.segmentStartMs : 0;
  return clock.phaseAccumulatedMs + open;
}

export function totalElapsedMs(clock: FocusClock, nowMs: number): number {
  const open = clock.segmentStartMs !== null ? nowMs - clock.segmentStartMs : 0;
  return clock.totalFocusedMs + open;
}

function phaseThresholdMs(clock: FocusClock, cfg: PomodoroConfig): number {
  if (clock.phase === 'focus') return cfg.focusMinutes * 60_000;
  return (clock.currentBreakIsLong ? cfg.longBreakMinutes : cfg.breakMinutes) * 60_000;
}

export interface PomodoroTransition {
  transitionedTo: PomodoroPhase;
}

/** Advances pomodoro phase transitions. Call this every frame while the
 * clock might be running; a no-op in open-ended mode or while paused. The
 * clock keeps running straight through a transition (SPEC: "during breaks
 * the colony rests" — that's `sim.focusRunning` reading `phase === 'focus'`
 * elsewhere, not this clock stopping), so callers just need to know a
 * transition happened, to play the chime and swap the button label. */
export function tickPomodoro(clock: FocusClock, nowMs: number, cfg: PomodoroConfig): PomodoroTransition | null {
  if (clock.mode !== 'pomodoro' || !clock.running) return null;
  if (phaseElapsedMs(clock, nowMs) < phaseThresholdMs(clock, cfg)) return null;

  foldSegment(clock, nowMs);
  clock.phaseAccumulatedMs = 0;
  if (clock.phase === 'focus') {
    clock.roundsCompleted++;
    clock.currentBreakIsLong = clock.roundsCompleted % cfg.roundsBeforeLongBreak === 0;
    clock.phase = 'break';
  } else {
    clock.phase = 'focus';
  }
  return { transitionedTo: clock.phase };
}

/** `m:ss` under an hour, `h:mm:ss` after (SPEC section 8). `minutesOnly`
 * drops the seconds for a hidden tab's throttled title updates. */
export function formatDuration(ms: number, minutesOnly = false): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (minutesOnly) return hours > 0 ? `${hours}:${pad(minutes)}` : `${minutes}`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** What the timer digits should show right now (SPEC: pomodoro counts down
 * the current phase; open-ended counts up the session total). */
export function displayMs(clock: FocusClock, nowMs: number, cfg: PomodoroConfig): number {
  if (clock.mode === 'open-ended') return totalElapsedMs(clock, nowMs);
  return Math.max(0, phaseThresholdMs(clock, cfg) - phaseElapsedMs(clock, nowMs));
}
