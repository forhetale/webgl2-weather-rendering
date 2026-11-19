// 1. 全屏三角形顶点着色器（用于背景风速标量场与等速线渲染）
export const fullscreenVertexShader = `#version 300 es
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

// 2. GFS 风速标量场 + 等风速线片元着色器
export const scalarFieldFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uWindTex;
uniform vec2 uWindMin;
uniform vec2 uWindMax;
uniform float uMaxSpeed;

in vec2 vUv;
out vec4 fragColor;

// 气象风速色带（深蓝 -> 青 -> 绿 -> 黄 -> 橙红）
vec3 windSpeedColormap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.05, 0.11, 0.24);
  vec3 c1 = vec3(0.08, 0.34, 0.56);
  vec3 c2 = vec3(0.14, 0.64, 0.60);
  vec3 c3 = vec3(0.84, 0.78, 0.26);
  vec3 c4 = vec3(0.86, 0.24, 0.18);

  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  vec4 sampleData = texture(uWindTex, vUv);
  vec2 wind = mix(uWindMin, uWindMax, sampleData.rg);
  float speedNorm = clamp(length(wind) / max(uMaxSpeed, 1e-4), 0.0, 1.0);

  vec3 color = windSpeedColormap(pow(speedNorm, 0.85)) * 0.85;

  // 等风速线（Isotachs）
  float levels = 10.0;
  float contour = abs(fract(speedNorm * levels + 0.5) - 0.5) / max(fwidth(speedNorm * levels), 0.001);
  float lineMask = 1.0 - smoothstep(0.75, 1.6, contour);
  color = mix(color, vec3(0.88, 0.95, 1.0), lineMask * 0.18);

  // 经纬网格参考线（每 30° 一条）
  vec2 gridCoord = vUv * vec2(12.0, 6.0);
  vec2 gridDist = abs(fract(gridCoord + 0.5) - 0.5) / max(fwidth(gridCoord), 0.001);
  float gridLine = 1.0 - smoothstep(0.6, 1.4, min(gridDist.x, gridDist.y));
  color = mix(color, vec3(0.65, 0.78, 0.92), gridLine * 0.12);

  fragColor = vec4(color, 1.0);
}
`;

// 3. WebGL2 Transform Feedback 风场粒子平流更新着色器
export const particleUpdateVertexShader = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aState; // xy: normalized pos [0,1], z: age [0,1], w: seed

uniform sampler2D uWindTex;
uniform vec2 uWindMin;
uniform vec2 uWindMax;
uniform float uDt;
uniform float uTime;
uniform float uSpeedScale;

out vec4 vNextState;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 sampleWind(vec2 uv) {
  vec2 encoded = texture(uWindTex, uv).rg;
  return mix(uWindMin, uWindMax, encoded);
}

void main() {
  vec2 pos = aState.xy;
  float age = aState.z;
  float seed = aState.w;

  // 中点法（RK2）采样风场并推进粒子
  vec2 wind0 = sampleWind(pos);
  vec2 vel0 = wind0 * uSpeedScale;
  vec2 midPos = vec2(fract(pos.x + vel0.x * uDt * 0.5), clamp(pos.y + vel0.y * uDt * 0.5, 0.002, 0.998));
  vec2 wind1 = sampleWind(midPos);

  vec2 nextPos = pos + wind1 * uSpeedScale * uDt;
  float nextAge = age + uDt * 0.22;

  // 经度环绕
  nextPos.x = fract(nextPos.x);

  // 粒子寿命结束或超出极地边界时重生
  bool outOfBounds = nextPos.y <= 0.004 || nextPos.y >= 0.996;
  if (nextAge >= 1.0 || outOfBounds) {
    float rx = hash12(vec2(seed * 73.17, uTime * 1.31 + float(gl_VertexID) * 0.013));
    float ry = hash12(vec2(uTime * 0.97 + float(gl_VertexID) * 0.017, seed * 41.29));
    nextPos = vec2(rx, 0.02 + ry * 0.96);
    nextAge = 0.0;
  }

  vNextState = vec4(nextPos, nextAge, seed);
}
`;

export const particleUpdateFragmentShader = `#version 300 es
precision highp float;
void main() {}
`;

// 4. 风场粒子渲染着色器
export const particleDrawVertexShader = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aState;

uniform sampler2D uWindTex;
uniform vec2 uWindMin;
uniform vec2 uWindMax;
uniform float uMaxSpeed;
uniform float uPointSize;

out float vSpeedNorm;
out float vAlpha;

void main() {
  vec2 pos = aState.xy;
  float age = aState.z;

  vec2 wind = mix(uWindMin, uWindMax, texture(uWindTex, pos).rg);
  vSpeedNorm = clamp(length(wind) / max(uMaxSpeed, 1e-4), 0.0, 1.0);

  // 粒子出生淡入、结束淡出
  vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.75, 1.0, age));

  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointSize;
}
`;

export const particleDrawFragmentShader = `#version 300 es
precision highp float;

in float vSpeedNorm;
in float vAlpha;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  float dist = length(coord);
  if (dist > 0.5) discard;

  float soft = 1.0 - smoothstep(0.18, 0.5, dist);
  vec3 tint = mix(vec3(0.75, 0.92, 1.0), vec3(1.0, 0.95, 0.72), vSpeedNorm);
  fragColor = vec4(tint, soft * vAlpha * (0.45 + 0.55 * vSpeedNorm));
}
`;

// 5. 拖尾淡出片元着色器
export const fadeFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uPrevTex;
uniform float uFadeFactor;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 prev = texture(uPrevTex, vUv);
  fragColor = vec4(prev.rgb, prev.a * uFadeFactor);
}
`;

// 6. 最终合成片元着色器（标量场底图 + 粒子拖尾图层）
export const compositeFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uTrailTex;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 trail = texture(uTrailTex, vUv);
  fragColor = trail;
}
`;
