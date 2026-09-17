import { test } from '@playwright/test';

test('sky and soil placeholder', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#app canvas');
  await page.screenshot({ path: 'screenshots/m0-sky-soil.png' });
});
