import { expect, test } from '@playwright/test';

test('loads with no console errors and shows a canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

// MILESTONES M6 done-when: "Playwright smoke test covers start, pause,
// resume, pomodoro transition, and end session." (Save picture was scoped
// out — see the M6 report.)
test('start, pause, and resume', async ({ page }) => {
  test.setTimeout(60000); // headroom for the occasional Chromium freeze noted below
  await page.goto('/');
  const startButton = page.getByRole('button', { name: 'Start focusing' });
  await startButton.click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // The timer counts up in open-ended mode (the default) — a real value
  // change, not just the label, confirms the focus clock is actually
  // running rather than the button having merely toggled cosmetically.
  // A generous timeout: this test's page occasionally gets frozen by
  // Chromium for several real seconds shortly after load — confirmed (via
  // instrumenting requestAnimationFrame, setInterval, and even a bare
  // page.evaluate() round trip, all stalling identically) as the browser
  // pausing this page's whole JS thread, unrelated to anything the app
  // does. It always resumes and catches up on its own; this just needs to
  // out-wait the stall rather than treat it as a failure.
  const timer = page.locator('#timer');
  const firstReading = await timer.textContent();
  await expect(timer).not.toHaveText(firstReading ?? '', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume focusing' })).toBeVisible();
  await page.waitForTimeout(250); // let any in-flight animation frame settle before reading the "frozen" value
  const pausedReading = await timer.textContent();
  await page.waitForTimeout(1200);
  await expect(timer).toHaveText(pausedReading ?? '');

  await page.getByRole('button', { name: 'Resume focusing' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('pomodoro transitions from focus to break', async ({ page }) => {
  // Playwright's Clock replaces Date/timers/requestAnimationFrame with a
  // virtual clock the test controls directly — the only practical way to
  // observe a 25-minute transition without either waiting 25 real minutes
  // or adding a test-only override to the real pacing config. Per
  // Playwright's own docs, time still ticks forward normally right after
  // install() (so page load doesn't stall); it only holds still once
  // explicitly paused. That means the countdown may already read a few
  // seconds under "25:00" by the time we check it — this asserts the
  // meaningful transition, not that exact starting instant.
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('radio', { name: 'Pomodoro' }).check();
  await page.getByRole('button', { name: 'Start focusing' }).click();
  await expect(page.locator('#timer')).toHaveText(/^2[45]:\d\d$/);

  await page.clock.fastForward('25:01');
  // The button just says "Pause" through a transition (phase doesn't change
  // that wording — see controls.ts), so the transition itself shows up in
  // the countdown resetting to the break length instead.
  await expect(page.locator('#timer')).toHaveText(/^[45]:\d\d$/);
});

test('end session shows the summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Start focusing' }).click();
  await page.waitForTimeout(1200); // a little real focused time to report in the summary
  await page.getByRole('button', { name: 'End session' }).click();

  await expect(page.getByText('Session complete')).toBeVisible();
  await expect(page.getByText(/^Focused$/)).toBeVisible();
  expect(errors).toEqual([]);
});
