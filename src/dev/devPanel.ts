// Dev-mode panel (SPEC section 11), enabled with ?dev=1. Empty in M0; each
// later milestone adds its own controls (time scale, overlays, stats, ...).

export function mountDevPanel(seed: string): void {
  const details = document.createElement('details');
  details.id = 'dev-panel';
  details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'Dev';
  details.appendChild(summary);

  const seedLine = document.createElement('div');
  seedLine.textContent = `seed: ${seed}`;
  details.appendChild(seedLine);

  document.body.appendChild(details);
}
