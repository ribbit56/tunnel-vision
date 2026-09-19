// Hand-authored tunnel mask for M1 (MILESTONES.md): an entrance, a main
// shaft, three chambers, and a side shaft. Painted directly at grid
// resolution (one texel per cell) — the soft edges in the final render come
// from bilinear-sampling this low-res mask in the tunnel shader, not from
// anything drawn here (SPEC "Tunnel rendering").
import { Texture } from 'pixi.js';
import { world } from '../config';

interface Point {
  x: number;
  y: number;
}

function drawThickPath(ctx: CanvasRenderingContext2D, points: Point[], radius: number): void {
  ctx.lineWidth = radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function drawChamber(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function buildHandAuthoredMask(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = world.gridW;
  canvas.height = world.gridH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable while building tunnel mask');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Entrance mouth, right at the grass line.
  drawChamber(ctx, 200, 2, 10, 6);

  // Main shaft: a gentle wander downward, never perfectly straight.
  drawThickPath(
    ctx,
    [
      { x: 200, y: 2 },
      { x: 202, y: 22 },
      { x: 206, y: 48 },
      { x: 210, y: 78 },
      { x: 205, y: 112 },
      { x: 210, y: 142 },
      { x: 208, y: 166 },
      { x: 212, y: 186 },
    ],
    2.5,
  );

  // Secondary shaft, branching off the main shaft partway down.
  drawThickPath(
    ctx,
    [
      { x: 208, y: 130 },
      { x: 230, y: 146 },
      { x: 255, y: 163 },
      { x: 272, y: 189 },
    ],
    2,
  );

  // Three chambers, each with a short connector stub, alternating sides.
  drawThickPath(ctx, [{ x: 206, y: 48 }, { x: 176, y: 38 }], 2.2);
  drawChamber(ctx, 168, 36, 32, 8);

  drawThickPath(ctx, [{ x: 205, y: 112 }, { x: 234, y: 100 }], 2.2);
  drawChamber(ctx, 240, 98, 36, 9);

  drawThickPath(ctx, [{ x: 212, y: 186 }, { x: 182, y: 193 }], 2.2);
  drawChamber(ctx, 174, 194, 26, 7);

  const texture = Texture.from(canvas);
  // Bilinear filtering is what turns this blocky paint job into the soft
  // organic edges the shader relies on (SPEC "Tunnel rendering").
  texture.source.scaleMode = 'linear';
  return texture;
}
