import { test } from '@playwright/test';

test('sky and soil placeholder', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#app canvas');
  await page.screenshot({ path: 'screenshots/m0-sky-soil.png' });
});

// M1 art-direction gallery (MILESTONES.md): the four time-of-day keyframes at
// desktop and phone widths, for Ben to review against docs/reference/.
const TIMES_OF_DAY: { name: string; hour: number }[] = [
  { name: 'dawn', hour: 6 },
  { name: 'day', hour: 12 },
  { name: 'dusk', hour: 18.5 },
  { name: 'night', hour: 0 },
];

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  for (const timeOfDay of TIMES_OF_DAY) {
    test(`m1 gallery ${viewport.name} ${timeOfDay.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=acorn&dev=1');
      await page.waitForSelector('#app canvas');
      await page.locator('#dev-panel input[type=range]').evaluate((el: HTMLInputElement, hour) => {
        el.value = String(hour);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, timeOfDay.hour);
      await page.waitForTimeout(200);
      await page.screenshot({
        path: `screenshots/m1-${viewport.name}-${timeOfDay.name}.png`,
      });
    });
  }
}

// M2 gallery (MILESTONES.md): the single digger's tunnel after a while at
// 300x dev time scale, for a couple of seeds, to check the growth reads as
// organic (no grid artifacts) and bends differently per seed.
const M2_SEEDS = ['acorn', 'birch'];

for (const seed of M2_SEEDS) {
  test(`m2 gallery digger ${seed}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: '300x' }).click();
    await page.waitForTimeout(60000);
    await page.screenshot({ path: `screenshots/m2-digger-${seed}.png` });
  });
}

// M3 gallery (MILESTONES.md): 20 ants (3 digging, the rest wandering) after
// a while, to check the crowd reads as calm and the shafts fan out rather
// than overlapping (docs/reference/'s nest casts). A shorter dev time scale
// than M2's — 20 ants dig roughly 3x faster, so the same 300x/60s stretch
// grows a much bigger nest than intended for a comparable-looking shot.
for (const seed of M2_SEEDS) {
  test(`m3 gallery ants ${seed}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: '60x' }).click();
    await page.waitForTimeout(20000);
    await page.screenshot({ path: `screenshots/m3-ants-${seed}.png` });
  });
}

// M3 motion sequence (MILESTONES.md done-when: "a 60-second recording or
// screenshot sequence shows no jitter, snapping, or overlapping ants").
// Runs at 1x (real viewing speed, not dev fast-forward) and captures a
// handful of frames a couple of seconds apart for Ben to flip through.
test('m3 motion sequence acorn', async ({ page }) => {
  // 60000 was consistently juuust enough to time out on the 6th of 6
  // screenshots under any load at all (the first 5 always completed) —
  // more headroom, not a functional problem with the app.
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn&dev=1');
  await page.waitForSelector('#app canvas');
  // A little 60x head start so there's an actual tunnel network with a few
  // wanderers spread through it, rather than everyone still bunched at the
  // bare entrance notch.
  await page.getByRole('button', { name: '60x' }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: '1x' }).click();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `screenshots/m3-motion-acorn-${i}.png` });
  }
});

// M4/M5 gallery (MILESTONES.md done-when: "gallery of at least 6 seeds at a
// 2-hour-equivalent size: every nest looks different and every nest looks
// good"). Uses the dev panel's own "+120m" jump-focus button rather than
// waiting through dev time scale.
const M4_SEEDS = ['acorn', 'birch', 'cedar', 'dogwood', 'elm', 'fern'];

for (const seed of M4_SEEDS) {
  test(`m4 gallery nest ${seed}`, async ({ page }) => {
    // Population growth is dynamic now (M5), so a 2-hour-equivalent jump's
    // cost varies more by seed than a fixed ant count did.
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: '+120m' }).click({ timeout: 220000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m4-nest-${seed}.png` });
  });
}

// M5 gallery (MILESTONES.md done-when: "screenshots at 0, 10, 25 minutes and
// 2 hours for 3 seeds"). 0 minutes is the founding sequence at page load,
// before focus has ever run — the other marks build on it with the dev
// panel's own jump-focus buttons (which start focus running on their own).
const M5_SEEDS = ['acorn', 'birch', 'cedar'];

for (const seed of M5_SEEDS) {
  test(`m5 gallery nest ${seed} at 0min`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m5-nest-${seed}-0min.png` });
  });

  test(`m5 gallery nest ${seed} at 10min`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: '+5m' }).click();
    await page.getByRole('button', { name: '+5m' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m5-nest-${seed}-10min.png` });
  });

  test(`m5 gallery nest ${seed} at 25min`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '+5m' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m5-nest-${seed}-25min.png` });
  });

  test(`m5 gallery nest ${seed} at 2h`, async ({ page }) => {
    // Population growth is dynamic now (M5), so a 2-hour-equivalent jump's
    // cost varies more by seed than M4's fixed 20-ant runs did.
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?seed=${seed}&dev=1`);
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: '+120m' }).click({ timeout: 220000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m5-nest-${seed}-2h.png` });
  });
}

// M6 gallery (MILESTONES.md M6: real timer/pomodoro/settings/session-summary
// UI). No `?dev=1` — this is the plain player-facing HUD, not the dev panel.
test('m6 gallery running with task name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn');
  await page.waitForSelector('#app canvas');
  await page.getByRole('button', { name: 'Start focusing' }).click();
  await page.locator('#task-name').click();
  await page.keyboard.type('Writing the M6 report');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/m6-running-open-ended.png' });
});

test('m6 gallery pomodoro countdown', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn');
  await page.waitForSelector('#app canvas');
  await page.getByRole('radio', { name: 'Pomodoro' }).check();
  await page.getByRole('button', { name: 'Start focusing' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/m6-pomodoro-countdown.png' });
});

test('m6 gallery settings panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn');
  await page.waitForSelector('#app canvas');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'screenshots/m6-settings-panel.png' });
});

test('m6 gallery session summary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn');
  await page.waitForSelector('#app canvas');
  await page.getByRole('button', { name: 'Start focusing' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'End session' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'screenshots/m6-session-summary.png' });
});

// M7 gallery (MILESTONES.md done-when: "a 24-step screenshot strip across
// one compressed day shows smooth, pleasing transitions with no abrupt
// jumps"). Uses the dev panel's own hour slider (SPEC section 11 "force
// time of day") to step through a full day on a populated colony.
test('m7 gallery 24-step day/night strip', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn&dev=1');
  await page.waitForSelector('#app canvas');
  await page.getByRole('button', { name: '+30m' }).click();
  await page.waitForTimeout(200);

  const hourSlider = page.locator('#dev-panel input[type=range]');
  for (let hour = 0; hour < 24; hour++) {
    await hourSlider.evaluate((el: HTMLInputElement, h) => {
      el.value = String(h);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, hour);
    await page.waitForTimeout(100);
    await page.screenshot({ path: `screenshots/m7-day-${String(hour).padStart(2, '0')}.png` });
  }
});

// M8 gallery (MILESTONES.md done-when: "screenshots of clouding, rain, and
// clearing at day and night"). Uses the dev panel's force-hour slider and
// force-weather buttons (SPEC section 11) rather than waiting through the
// real seeded schedule.
const M8_WEATHER_PHASES = ['clouding', 'rain', 'clearing'] as const;
const M8_TIMES_OF_DAY: { name: string; hour: number }[] = [
  { name: 'day', hour: 12 },
  { name: 'night', hour: 0 },
];

test('m8 gallery weather at day and night', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn&dev=1');
  await page.waitForSelector('#app canvas');
  // A little population so foragers/idlers are visible reacting to weather.
  await page.getByRole('button', { name: '+30m' }).click();
  await page.waitForTimeout(200);

  for (const timeOfDay of M8_TIMES_OF_DAY) {
    await page.locator('#dev-panel input[type=range]').evaluate((el: HTMLInputElement, hour) => {
      el.value = String(hour);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, timeOfDay.hour);
    for (const phase of M8_WEATHER_PHASES) {
      await page.getByRole('button', { name: phase, exact: true }).click();
      // The dev panel's own stats readout polls on a 250ms interval — a
      // shorter wait risks the screenshot landing on a stale reading from
      // the previous phase.
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/m8-${timeOfDay.name}-${phase}.png` });
    }
  }
});

// M9 gallery (MILESTONES.md done-when: "each surprise can be triggered from
// dev mode and looks at home in the art style"). Each dev-panel trigger is a
// one-shot preview (SPEC section 11 "trigger any surprise"), so this just
// clicks it and screenshots shortly after — well before even the shortest
// occurrence's configured duration ends.
const M9_SURPRISE_KINDS = ['earthworm', 'beetle', 'butterfly', 'snail', 'fallingLeaf', 'extraFireflies'] as const;

test('m9 gallery small surprises', async ({ page }) => {
  // 6 iterations of wait+screenshot, same margin lesson as M3's motion
  // sequence test: 60000 was consistently too tight under any load.
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=acorn&dev=1');
  await page.waitForSelector('#app canvas');
  await page.getByRole('button', { name: '+30m' }).click();
  await page.waitForTimeout(200);

  for (const kind of M9_SURPRISE_KINDS) {
    // extraFireflies only actually shows at night (SPEC: "night" only) — the
    // dev trigger still fires it at any hour, but it fades with night
    // factor, so force night first to see it as a player actually would.
    if (kind === 'extraFireflies') {
      await page.locator('#dev-panel input[type=range]').evaluate((el: HTMLInputElement) => {
        el.value = '0';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(200);
    }
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `screenshots/m9-${kind}.png` });
  }
});

// M11 layout pass (MILESTONES.md "Phone and tablet layout pass" / SPEC
// section 10: "layout works down to phone width"). M1's own gallery already
// covers the bare scenery at phone width; this covers the interactive HUD
// (controls, settings panel, session summary) that M1 predates.
const M11_LAYOUT_VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

for (const viewport of M11_LAYOUT_VIEWPORTS) {
  test(`m11 layout ${viewport.name} running with task name`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=acorn');
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: 'Start focusing' }).click();
    await page.locator('#task-name').click();
    await page.keyboard.type('Writing the M11 report');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `screenshots/m11-${viewport.name}-running.png` });
  });

  test(`m11 layout ${viewport.name} settings panel`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=acorn');
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m11-${viewport.name}-settings.png` });
  });

  test(`m11 layout ${viewport.name} session summary`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=acorn');
    await page.waitForSelector('#app canvas');
    await page.getByRole('button', { name: 'Start focusing' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'End session' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `screenshots/m11-${viewport.name}-summary.png` });
  });
}
