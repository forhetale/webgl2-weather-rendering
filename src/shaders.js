export const vertexShaderSource = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);

out vec2 vUv;

void main() {
  vec2 pos = POSITIONS[gl_VertexID];
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const fragmentShaderSource = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = p * 2.02 + vec2(1.7, -1.3);
    amp *= 0.5;
  }
  return value;
}

// 模拟气象温度/气压标量场色带（蓝 -> 青 -> 绿 -> 黄 -> 红）
vec3 weatherColormap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.08, 0.22, 0.55);
  vec3 c1 = vec3(0.10, 0.62, 0.78);
  vec3 c2 = vec3(0.35, 0.80, 0.45);
  vec3 c3 = vec3(0.96, 0.82, 0.24);
  vec3 c4 = vec3(0.86, 0.22, 0.18);

  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 p = (vUv - 0.5) * aspect * 3.2;

  // 域扭曲模拟大气环流平流效果
  vec2 flow = vec2(
    fbm(p + vec2(uTime * 0.06, -uTime * 0.04)),
    fbm(p + vec2(-uTime * 0.05, uTime * 0.07) + vec2(4.2, 1.8))
  );
  float field = fbm(p + (flow - 0.5) * 1.45);

  vec3 color = weatherColormap(smoothstep(0.22, 0.82, field));

  // 叠加柔和等值线（等压/等温线）
  float levels = 14.0;
  float contour = abs(fract(field * levels + 0.5) - 0.5) / max(fwidth(field * levels), 0.001);
  float lineMask = 1.0 - smoothstep(0.8, 1.8, contour);
  color = mix(color, vec3(0.95, 0.98, 1.0), lineMask * 0.28);

  fragColor = vec4(color, 1.0);
}
`;
