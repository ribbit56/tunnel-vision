import { describe, expect, it } from 'vitest';
import { createWorld, updateMoisture, type MoistureConfig } from '../src/sim/world';

const CFG: MoistureConfig = {
  moistureMaxDepthCells: 10,
  moistureRiseRatePerSecond: 0.5,
  moistureDryRatePerSecond: 0.01,
  moistureFrontRatePerSecond: 0.4,
};

// A small grid — moisture doesn't care about the terrain generated inside
// it, so this just needs to be big enough that `moistureMaxDepthCells` fits.
function smallWorld() {
  return createWorld('acorn', 20, 30, 4);
}

describe('updateMoisture', () => {
  it('starts fully dry', () => {
    const world = smallWorld();
    expect(world.moisture[0]).toBe(0);
  });

  it('rises at the surface while raining', () => {
    const world = smallWorld();
    for (let i = 0; i < 60; i++) updateMoisture(world, 1, 1 / 30, CFG);
    expect(world.moisture[0]).toBeGreaterThan(0.5);
  });

  it('never exceeds 1 even after a long soak', () => {
    const world = smallWorld();
    for (let i = 0; i < 30 * 60 * 5; i++) updateMoisture(world, 1, 1 / 30, CFG);
    expect(world.moisture[0]).toBeLessThanOrEqual(1);
  });

  it('is uniform across every column at a given depth (rain falls evenly)', () => {
    const world = smallWorld();
    for (let i = 0; i < 90; i++) updateMoisture(world, 1, 1 / 30, CFG);
    const row = 2;
    const first = world.moisture[row * world.gridW];
    for (let cx = 0; cx < world.gridW; cx++) {
      expect(world.moisture[row * world.gridW + cx]).toBe(first);
    }
  });

  it('dries out over time once rain stops', () => {
    const world = smallWorld();
    for (let i = 0; i < 30 * 60; i++) updateMoisture(world, 1, 1 / 30, CFG); // soak for a minute
    const wetValue = world.moisture[0];
    expect(wetValue).toBeGreaterThan(0);
    for (let i = 0; i < 30 * 60 * 10; i++) updateMoisture(world, 0, 1 / 30, CFG); // dry for 10 minutes
    expect(world.moisture[0]).toBeLessThan(wetValue * 0.1);
  });

  it('never sets moisture below the configured depth', () => {
    const world = smallWorld();
    for (let i = 0; i < 30 * 60 * 20; i++) updateMoisture(world, 1, 1 / 30, CFG); // soak for 20 minutes
    const belowRow = CFG.moistureMaxDepthCells;
    expect(world.moisture[belowRow * world.gridW]).toBe(0);
  });
});
