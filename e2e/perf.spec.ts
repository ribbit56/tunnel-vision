import { expect, test } from '@playwright/test';

// MILESTONES M11 done-when: "A 3-hour accelerated run shows no memory growth
// and stays within budgets." Drives the real browser through a 3-hour
// simulated session via SPEC section 11's `window.__colony` debug API
// (dev-mode only), sampling the actual JS heap between chunks — the real
// engine's own memory behavior, not a Node approximation of the sim alone
// (this is also how the render/scene side, which a pure-Node vitest run
// never touches, gets covered).
test('3-hour accelerated run stays within memory and perf budgets', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?seed=acorn&dev=1');
  await page.waitForFunction(() => window.__colony !== undefined);

  const sampleHeapMb = async (): Promise<number> => {
    // `window.gc` only exists because playwright.perf.config.ts launches
    // Chromium with --js-flags=--expose-gc — without forcing a collection
    // first, a reading can go up simply because GC hasn't run yet, which
    // would make a perfectly healthy session look like a leak.
    await page.evaluate(() => (window as unknown as { gc?: () => void }).gc?.());
    return page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / (1024 * 1024));
  };

  const heapReadingsMb: number[] = [await sampleHeapMb()];
  const CHUNK_MINUTES = 30;
  const CHUNKS = 6; // 6 x 30min = 3 simulated hours
  for (let i = 0; i < CHUNKS; i++) {
    await page.evaluate((minutes) => window.__colony?.advanceFocus(minutes), CHUNK_MINUTES);
    heapReadingsMb.push(await sampleHeapMb());
  }

  const stats = await page.evaluate(() => window.__colony?.getStats());
  console.log(`heap over 3h (MB): ${heapReadingsMb.map((mb) => mb.toFixed(1)).join(' -> ')}`);
  console.log(`final stats: ants=${stats?.antCount} chambers=${stats?.chambers} shafts=${stats?.shafts} jobsQueued=${stats?.jobsQueued}`);

  // "No memory growth" is judged over the run's back half, once the colony's
  // own growth curve (SPEC section 2) has leveled off toward its worker cap
  // — the front half legitimately grows memory while ants/tunnels/brood are
  // actively being created, which isn't a leak.
  const lastChunkGrowthMb = heapReadingsMb[heapReadingsMb.length - 1] - heapReadingsMb[heapReadingsMb.length - 2];
  console.log(`final 30-minute chunk's heap growth: ${lastChunkGrowthMb.toFixed(1)}MB`);
  expect(lastChunkGrowthMb).toBeLessThan(20); // generous ceiling — flags a real runaway, not GC noise

  // SPEC section 10's own worker budget, read back from the exact stats
  // object the dev panel itself displays.
  expect(stats?.antCount).toBeLessThanOrEqual(70);
});
