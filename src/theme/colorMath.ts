// Small color helpers shared by anything that blends palette colors (sky
// keyframes, depth dimming, moisture darkening, ...). Pure math, no DOM.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToNumber({ r, g, b }: Rgb): number {
  return (r << 16) | (g << 8) | b;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linearly blends two hex colors and returns a Pixi-friendly 0xRRGGBB number. */
export function lerpColor(hexA: string, hexB: string, t: number): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToNumber({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  });
}

/** Darkens a hex color toward black by `amount` (0 = unchanged, 1 = black). */
export function darken(hex: string, amount: number): number {
  const c = hexToRgb(hex);
  const k = 1 - amount;
  return rgbToNumber({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k) });
}
