// The end-of-session summary panel (SPEC section 8 "Session summary").
import { formatDuration } from '../timer/focusClock';

export interface SessionStats {
  focusedMs: number;
  workers: number;
  broodCount: number;
  chambersCount: number;
  /** SPEC: "soil carried (pellets)" — `mound.totalDeposited`. */
  pelletsCarried: number;
  seed: string;
}

export interface SessionSummaryActions {
  onStartNewColony(): void;
  onKeepWatching(): void;
}

export interface SessionSummary {
  show(stats: SessionStats): void;
  hide(): void;
  isOpen(): boolean;
}

function statRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'summary-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'summary-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'summary-stat-value';
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

export function mountSessionSummary(hud: HTMLElement, actions: SessionSummaryActions): SessionSummary {
  const overlay = document.createElement('div');
  overlay.id = 'session-summary';
  overlay.hidden = true;

  const panel = document.createElement('div');
  panel.id = 'session-summary-panel';
  overlay.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'summary-title';
  title.textContent = 'Session complete';
  panel.appendChild(title);

  const stats = document.createElement('div');
  stats.id = 'summary-stats';
  panel.appendChild(stats);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'summary-actions';

  const newColonyButton = document.createElement('button');
  newColonyButton.type = 'button';
  newColonyButton.textContent = 'Start a new colony';
  newColonyButton.addEventListener('click', () => actions.onStartNewColony());

  const keepWatchingButton = document.createElement('button');
  keepWatchingButton.type = 'button';
  keepWatchingButton.textContent = 'Keep watching';
  keepWatchingButton.addEventListener('click', () => actions.onKeepWatching());

  actionsRow.append(newColonyButton, keepWatchingButton);
  panel.appendChild(actionsRow);

  hud.appendChild(overlay);

  let open = false;

  return {
    isOpen: () => open,
    show(s: SessionStats): void {
      stats.replaceChildren(
        statRow('Focused', formatDuration(s.focusedMs)),
        statRow('Workers', String(s.workers)),
        statRow('Brood', String(s.broodCount)),
        statRow('Chambers', String(s.chambersCount)),
        statRow('Soil carried', `${s.pelletsCarried.toFixed(0)} pellets`),
        statRow('Seed', s.seed),
      );
      overlay.hidden = false;
      open = true;
    },
    hide(): void {
      overlay.hidden = true;
      open = false;
    },
  };
}
