import { describe, expect, it } from 'vitest';
import {
  createFocusClock,
  displayMs,
  formatDuration,
  pauseClock,
  startClock,
  tickPomodoro,
  totalElapsedMs,
  type PomodoroConfig,
} from '../src/timer/focusClock';

const POMODORO: PomodoroConfig = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

describe('focus clock pause/resume math', () => {
  it('accumulates zero while never started', () => {
    const clock = createFocusClock('open-ended');
    expect(totalElapsedMs(clock, 10_000)).toBe(0);
  });

  it('counts up while running', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    expect(totalElapsedMs(clock, 5000)).toBe(5000);
  });

  it('freezes while paused', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    pauseClock(clock, 5000);
    expect(totalElapsedMs(clock, 5000)).toBe(5000);
    expect(totalElapsedMs(clock, 50_000)).toBe(5000); // time passing while paused doesn't count
  });

  it('resumes from where it left off across multiple segments', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    pauseClock(clock, 3000); // segment 1: 3000ms
    startClock(clock, 10_000); // gap of 7000ms, uncounted
    pauseClock(clock, 14_000); // segment 2: 4000ms
    expect(totalElapsedMs(clock, 14_000)).toBe(7000);
  });

  it('a huge gap between calls while running is still correct (hidden-tab case)', () => {
    // The clock has no idea whether the tab was visible in between — it's a
    // pure function of timestamps, which is exactly what makes it correct
    // regardless of how long the browser went without asking (SPEC: "the
    // timer is always correct because it uses timestamps").
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    const oneHourMs = 60 * 60_000;
    expect(totalElapsedMs(clock, oneHourMs)).toBe(oneHourMs);
  });

  it('double-starting or double-pausing is a no-op', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    startClock(clock, 1000); // ignored, already running
    expect(totalElapsedMs(clock, 2000)).toBe(2000);
    pauseClock(clock, 2000);
    pauseClock(clock, 5000); // ignored, already paused
    expect(totalElapsedMs(clock, 9000)).toBe(2000);
  });
});

describe('pomodoro transitions', () => {
  it('stays in focus phase until the focus length elapses', () => {
    const clock = createFocusClock('pomodoro');
    startClock(clock, 0);
    expect(tickPomodoro(clock, 24 * 60_000, POMODORO)).toBeNull();
    expect(clock.phase).toBe('focus');
  });

  it('transitions focus -> break once the focus length elapses, keeps running', () => {
    const clock = createFocusClock('pomodoro');
    startClock(clock, 0);
    const transition = tickPomodoro(clock, 25 * 60_000, POMODORO);
    expect(transition).toEqual({ transitionedTo: 'break' });
    expect(clock.phase).toBe('break');
    expect(clock.running).toBe(true);
    expect(clock.roundsCompleted).toBe(1);
  });

  it('transitions break -> focus once the short break elapses', () => {
    const clock = createFocusClock('pomodoro');
    startClock(clock, 0);
    tickPomodoro(clock, 25 * 60_000, POMODORO);
    const transition = tickPomodoro(clock, 25 * 60_000 + 5 * 60_000, POMODORO);
    expect(transition).toEqual({ transitionedTo: 'focus' });
  });

  it('every 4th round gets the long break instead of the short one', () => {
    const clock = createFocusClock('pomodoro');
    startClock(clock, 0);
    let now = 0;
    for (let round = 1; round <= 4; round++) {
      now += 25 * 60_000;
      tickPomodoro(clock, now, POMODORO); // focus -> break
      expect(clock.currentBreakIsLong).toBe(round % 4 === 0);
      now += (clock.currentBreakIsLong ? 15 : 5) * 60_000;
      tickPomodoro(clock, now, POMODORO); // break -> focus
    }
    expect(clock.roundsCompleted).toBe(4);
  });

  it('does nothing in open-ended mode', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    expect(tickPomodoro(clock, 999 * 60_000, POMODORO)).toBeNull();
    expect(clock.phase).toBe('focus');
  });

  it('does nothing while paused', () => {
    const clock = createFocusClock('pomodoro');
    expect(tickPomodoro(clock, 999 * 60_000, POMODORO)).toBeNull();
  });
});

describe('displayMs', () => {
  it('counts up in open-ended mode', () => {
    const clock = createFocusClock('open-ended');
    startClock(clock, 0);
    expect(displayMs(clock, 90_000, POMODORO)).toBe(90_000);
  });

  it('counts down the current phase in pomodoro mode', () => {
    const clock = createFocusClock('pomodoro');
    startClock(clock, 0);
    expect(displayMs(clock, 60_000, POMODORO)).toBe(24 * 60_000);
  });
});

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(65_000)).toBe('1:05');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(60 * 60_000 + 65_000)).toBe('1:01:05');
  });

  it('drops seconds for the hidden-tab title', () => {
    expect(formatDuration(65_000, true)).toBe('1');
    expect(formatDuration((60 * 60_000) + 65_000, true)).toBe('1:01');
  });
});
