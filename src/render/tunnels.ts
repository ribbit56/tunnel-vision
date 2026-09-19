// Builds the custom filter that turns a flat soil sprite into the tunnel
// render (SPEC "Tunnel rendering"): a low-res mask, bilinear-sampled and
// thresholded in the fragment shader for soft edges, a rim, and a floor
// highlight, plus a small tiling noise texture for hand-drawn wobble.
import { Filter, GlProgram, Texture, UniformGroup } from 'pixi.js';
import { createNoise2D } from 'simplex-noise';
import { world } from '../config';
import { createStream } from '../sim/rng';
import { hexToRgb } from '../theme/colorMath';
import { soilDepthDimming, tunnels as tunnelPalette } from '../theme/palette';
import { tunnelFragmentShader } from './shaders/tunnels.frag';
import { tunnelVertexShader } from './shaders/tunnels.vert';

function colorToVec3(hex: string): Float32Array {
  const { r, g, b } = hexToRgb(hex);
  return new Float32Array([r / 255, g / 255, b / 255]);
}

function buildWobbleTexture(seed: string): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable while building wobble texture');

  const noise = createNoise2D(createStream(seed, 'render:tunnelWobble'));
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (noise(x * 0.06, y * 0.06) + 1) / 2;
      const g = Math.round(v * 255);
      const idx = (y * size + x) * 4;
      image.data[idx] = g;
      image.data[idx + 1] = g;
      image.data[idx + 2] = g;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = Texture.from(canvas);
  texture.source.addressMode = 'repeat';
  texture.source.scaleMode = 'linear';
  return texture;
}

export function createTunnelFilter(seed: string, maskTexture: Texture): Filter {
  const wobbleTexture = buildWobbleTexture(seed);

  const tunnelUniforms = new UniformGroup({
    uWobbleAmount: { value: 0.035, type: 'f32' },
    uWobbleScale: { value: 6, type: 'f32' },
    uSampleStep: {
      value: new Float32Array([1 / world.gridW, 1 / world.gridH]),
      type: 'vec2<f32>',
    },
    uTunnelInterior: { value: colorToVec3(tunnelPalette.interior), type: 'vec3<f32>' },
    uTunnelRim: { value: colorToVec3(tunnelPalette.rim), type: 'vec3<f32>' },
    uFloorHighlight: { value: colorToVec3(tunnelPalette.floorHighlight), type: 'vec3<f32>' },
    uDepthDimMax: { value: soilDepthDimming.maxDarkenAtDepth, type: 'f32' },
  });

  return new Filter({
    glProgram: GlProgram.from({
      vertex: tunnelVertexShader,
      fragment: tunnelFragmentShader,
      name: 'tunnels-filter',
    }),
    resources: {
      tunnelUniforms,
      uMask: maskTexture.source,
      uMaskSampler: maskTexture.source.style,
      uWobble: wobbleTexture.source,
      uWobbleSampler: wobbleTexture.source.style,
    },
  });
}
