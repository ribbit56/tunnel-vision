// Persisted user preferences (SPEC section 8: "Settings persist in
// localStorage (wrapped in try/catch)"). Scoped to what actually exists so
// far — sound (M10) joins this shape once that milestone lands, rather than
// being stubbed here ahead of time.
import type { DayNightMode } from '../environment/dayNight';
import type { FocusMode } from '../timer/focusClock';

export type ReducedMotionSetting = 'system' | 'on' | 'off';
export type FrameRate = 30 | 60;
/** SPEC section 6: "12, 24, or 48" real minutes per compressed day. */
export type CompressedCycleMinutes = 12 | 24 | 48;

export interface Settings {
  frameRate: FrameRate;
  reducedMotion: ReducedMotionSetting;
  focusMode: FocusMode;
  dayNightMode: DayNightMode;
  compressedCycleMinutes: CompressedCycleMinutes;
}

const STORAGE_KEY = 'tunnel-vision:settings';

const DEFAULT_SETTINGS: Settings = {
  frameRate: 60,
  reducedMotion: 'system',
  focusMode: 'open-ended',
  dayNightMode: 'compressed',
  compressedCycleMinutes: 24,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Spread over the defaults rather than trusting the stored shape
    // outright, so an older save (missing a field a later version added)
    // still loads instead of leaving that field undefined.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing, a full quota, or storage disabled entirely — the
    // session just won't remember these next time, which is a fine
    // degradation for preferences (CLAUDE.md: wrap in try/catch, don't fail).
  }
}

/** Resolves the "system" option against the OS/browser preference, so
 * callers never need to branch on it themselves. */
export function resolveReducedMotion(setting: ReducedMotionSetting): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
