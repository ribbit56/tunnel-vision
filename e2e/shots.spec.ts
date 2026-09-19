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
