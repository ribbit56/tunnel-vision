// The settings panel (SPEC section 8 "Controls": the gear icon). Scoped to
// what's real so far — sound (M10) joins this panel once that milestone
// exists, rather than shipping inert controls ahead of time.
import type { CompressedCycleMinutes, FrameRate, ReducedMotionSetting, Settings } from '../app/settings';
import type { DayNightMode } from '../environment/dayNight';

export interface SettingsPanelActions {
  onFrameRateChange(rate: FrameRate): void;
  onReducedMotionChange(setting: ReducedMotionSetting): void;
  onDayNightModeChange(mode: DayNightMode): void;
  onCompressedCycleChange(minutes: CompressedCycleMinutes): void;
  /** `seed: null` means "random" — mirrors `session.ts`'s own `?seed=` rule. */
  onNewColony(seed: string | null): void;
}

export interface SettingsPanel {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

function radioRow(name: string, label: string, options: { value: string; label: string }[], selected: string, onChange: (value: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const legend = document.createElement('span');
  legend.className = 'settings-label';
  legend.textContent = label;
  row.appendChild(legend);

  const group = document.createElement('div');
  group.className = 'settings-options';
  for (const opt of options) {
    const optLabel = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = opt.value;
    input.checked = opt.value === selected;
    input.addEventListener('change', () => {
      if (input.checked) onChange(opt.value);
    });
    optLabel.append(input, opt.label);
    group.appendChild(optLabel);
  }
  row.appendChild(group);
  return row;
}

export function mountSettingsPanel(hud: HTMLElement, seed: string, settings: Settings, actions: SettingsPanelActions): SettingsPanel {
  const gear = document.createElement('button');
  gear.id = 'settings-gear';
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Settings');
  gear.textContent = '⚙';
  hud.appendChild(gear);

  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.hidden = true;

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  panel.appendChild(title);

  panel.appendChild(
    radioRow(
      'frame-rate',
      'Frame rate',
      [
        { value: '60', label: 'Smooth (60)' },
        { value: '30', label: 'Battery saver (30)' },
      ],
      String(settings.frameRate),
      (v) => actions.onFrameRateChange(Number(v) as FrameRate),
    ),
  );

  panel.appendChild(
    radioRow(
      'reduced-motion',
      'Reduced motion',
      [
        { value: 'system', label: 'Follow system' },
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      settings.reducedMotion,
      (v) => actions.onReducedMotionChange(v as ReducedMotionSetting),
    ),
  );

  const cycleLengthRow = radioRow(
    'cycle-length',
    'Day length',
    [
      { value: '12', label: '12 min' },
      { value: '24', label: '24 min' },
      { value: '48', label: '48 min' },
    ],
    String(settings.compressedCycleMinutes),
    (v) => actions.onCompressedCycleChange(Number(v) as CompressedCycleMinutes),
  );
  cycleLengthRow.hidden = settings.dayNightMode !== 'compressed';

  panel.appendChild(
    radioRow(
      'day-night-mode',
      'Day/night',
      [
        { value: 'compressed', label: 'Compressed' },
        { value: 'real-time', label: 'Real time' },
      ],
      settings.dayNightMode,
      (v) => {
        const mode = v as DayNightMode;
        cycleLengthRow.hidden = mode !== 'compressed';
        actions.onDayNightModeChange(mode);
      },
    ),
  );
  panel.appendChild(cycleLengthRow);

  const seedRow = document.createElement('div');
  seedRow.className = 'settings-row';
  const seedLabel = document.createElement('span');
  seedLabel.className = 'settings-label';
  seedLabel.textContent = 'Seed';
  seedRow.appendChild(seedLabel);

  const seedControls = document.createElement('div');
  seedControls.className = 'settings-options';
  const seedValue = document.createElement('code');
  seedValue.className = 'seed-value';
  seedValue.textContent = seed;
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy';
  copyButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(seed).catch(() => {
      // Clipboard access can be denied (permissions, insecure context) —
      // the seed is still shown as plain text either way.
    });
  });
  seedControls.append(seedValue, copyButton);
  seedRow.appendChild(seedControls);
  panel.appendChild(seedRow);

  const newColonyRow = document.createElement('div');
  newColonyRow.className = 'settings-row';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.placeholder = 'paste a seed…';
  seedInput.className = 'seed-input';
  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.textContent = 'New random colony';
  randomButton.addEventListener('click', () => actions.onNewColony(null));
  const pastedButton = document.createElement('button');
  pastedButton.type = 'button';
  pastedButton.textContent = 'Start from seed';
  pastedButton.addEventListener('click', () => {
    const value = seedInput.value.trim();
    if (value.length > 0) actions.onNewColony(value);
  });
  newColonyRow.append(seedInput, pastedButton, randomButton);
  panel.appendChild(newColonyRow);

  hud.appendChild(panel);

  let open = false;
  const setOpen = (next: boolean) => {
    open = next;
    panel.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);

  gear.addEventListener('click', () => setOpen(!open));

  return {
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
  };
}
