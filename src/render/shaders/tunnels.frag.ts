// The tunnel-rendering technique from docs/SPEC.md section 7. The mask is
// never drawn as blocks: it's a low-res (grid-resolution) density texture,
// bilinear-sampled and thresholded here to get soft organic edges, a darker
// rim, and a lighter floor highlight, with a touch of noise so the threshold
// itself wobbles instead of sitting at a perfectly smooth radius.
export const tunnelFragmentShader = `
in vec2 vTextureCoord;
in vec2 vLocalUv;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform sampler2D uWobble;

uniform float uWobbleAmount;
uniform float uWobbleScale;
uniform vec2 uSampleStep;
uniform vec3 uTunnelInterior;
uniform vec3 uTunnelRim;
uniform vec3 uFloorHighlight;
uniform float uDepthDimMax;

float openAmount(float maskValue) {
    return smoothstep(0.45, 0.55, maskValue);
}

void main(void)
{
    vec4 soilColor = texture(uTexture, vTextureCoord);

    float wobble = (texture(uWobble, vLocalUv * uWobbleScale).r - 0.5) * uWobbleAmount;

    float maskHere = texture(uMask, vLocalUv).r + wobble;
    float open = openAmount(maskHere);

    // Rim: a darker ring just outside the open threshold, on the solid side.
    float rimMask = smoothstep(0.18, 0.46, maskHere);
    float rim = (rimMask - open) * (1.0 - open);

    // Floor highlight: this fragment is solid, but the cell above it is open,
    // so this is the lit top surface of a tunnel floor.
    float maskAbove = texture(uMask, vLocalUv - vec2(0.0, uSampleStep.y)).r + wobble;
    float floorGlow = (1.0 - open) * openAmount(maskAbove);

    vec3 color = soilColor.rgb;
    color = mix(color, uTunnelRim, clamp(rim, 0.0, 1.0));
    color = mix(color, uFloorHighlight, clamp(floorGlow, 0.0, 1.0));

    // Blend a hint of the surrounding stratum into the tunnel interior so it
    // reads as a hollow in the soil rather than a hole punched to black.
    vec3 tunnelColor = mix(uTunnelInterior, soilColor.rgb, 0.1);
    color = mix(color, tunnelColor, open);

    // Soil dims gradually with depth regardless of time of day (SPEC section 7).
    color *= 1.0 - uDepthDimMax * clamp(vLocalUv.y, 0.0, 1.0);

    finalColor = vec4(color, 1.0);
}
`;
