// Standard Pixi v8 filter vertex shader (maps the quad onto the filtered
// object's own bounds). This boilerplate is the same for nearly every custom
// filter; kept here as plain GLSL so tunnels.frag.ts stays focused on the
// actual tunnel-rendering technique.
export const tunnelVertexShader = `
in vec2 aPosition;
out vec2 vTextureCoord;
// aPosition is already a clean 0..1 across the filtered object's own bounds.
// vTextureCoord (below) is calibrated for sampling the filter's padded,
// pooled-texture capture (uTexture) — not for sampling our own mask/wobble
// textures, which need this instead.
out vec2 vLocalUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vLocalUv = aPosition;
}
`;
