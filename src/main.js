import { createSyntheticGfsWindField, createWindTexture } from './gfsWindField.js';
import {
  fullscreenVertexShader,
  scalarFieldFragmentShader,
  particleUpdateVertexShader,
  particleUpdateFragmentShader,
  particleDrawVertexShader,
  particleDrawFragmentShader,
  fadeFragmentShader,
  compositeFragmentShader,
} from './shaders.js';

const PARTICLE_COUNT = 24000;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource, transformFeedbackVaryings = null) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  if (transformFeedbackVaryings) {
    gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.INTERLEAVED_ATTRIBS);
  }

  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

function createRenderTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

function createParticleBuffers(gl, count) {
  const initialData = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    initialData[i * 4 + 0] = Math.random();
    initialData[i * 4 + 1] = 0.02 + Math.random() * 0.96;
    initialData[i * 4 + 2] = Math.random();
    initialData[i * 4 + 3] = Math.random();
  }

  const buffers = [gl.createBuffer(), gl.createBuffer()];
  const vaos = [gl.createVertexArray(), gl.createVertexArray()];

  for (let i = 0; i < 2; i++) {
    gl.bindVertexArray(vaos[i]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
    gl.bufferData(gl.ARRAY_BUFFER, initialData, gl.DYNAMIC_COPY);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return { buffers, vaos };
}

function init() {
  const canvas = document.getElementById('gl-canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    document.body.innerHTML = '<p style="padding:24px;color:#f87171;">WebGL2 is not supported in this browser.</p>';
    return;
  }

  // 1. 构建 GFS 1° 全球风场网格并上传为 WebGL2 纹理
  const windField = createSyntheticGfsWindField(360, 181);
  const windTexture = createWindTexture(gl, windField);

  const metaEl = document.getElementById('hud-meta');
  if (metaEl) {
    metaEl.textContent =
      `GFS ${windField.width}×${windField.height} Grid · ${PARTICLE_COUNT.toLocaleString()} TF Particles · Max ${windField.maxSpeed.toFixed(1)} m/s`;
  }

  // 2. 编译着色器程序
  const scalarProgram = createProgram(gl, fullscreenVertexShader, scalarFieldFragmentShader);
  const updateProgram = createProgram(gl, particleUpdateVertexShader, particleUpdateFragmentShader, ['vNextState']);
  const drawProgram = createProgram(gl, particleDrawVertexShader, particleDrawFragmentShader);
  const fadeProgram = createProgram(gl, fullscreenVertexShader, fadeFragmentShader);
  const compositeProgram = createProgram(gl, fullscreenVertexShader, compositeFragmentShader);

  // 3. 初始化 Transform Feedback 双缓冲与全屏 VAO
  const fullscreenVao = gl.createVertexArray();
  const particles = createParticleBuffers(gl, PARTICLE_COUNT);
  const transformFeedback = gl.createTransformFeedback();

  // 4. 拖尾 Ping-Pong Framebuffer
  let trailTargets = null;
  let trailIdx = 0;
  let particleIdx = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height || !trailTargets) {
      canvas.width = width;
      canvas.height = height;
      if (trailTargets) {
        for (const rt of trailTargets) {
          gl.deleteFramebuffer(rt.fbo);
          gl.deleteTexture(rt.texture);
        }
      }
      trailTargets = [createRenderTarget(gl, width, height), createRenderTarget(gl, width, height)];
    }
  }

  window.addEventListener('resize', resize);
  resize();

  const locs = {
    scalar: {
      uWindTex: gl.getUniformLocation(scalarProgram, 'uWindTex'),
      uWindMin: gl.getUniformLocation(scalarProgram, 'uWindMin'),
      uWindMax: gl.getUniformLocation(scalarProgram, 'uWindMax'),
      uMaxSpeed: gl.getUniformLocation(scalarProgram, 'uMaxSpeed'),
    },
    update: {
      uWindTex: gl.getUniformLocation(updateProgram, 'uWindTex'),
      uWindMin: gl.getUniformLocation(updateProgram, 'uWindMin'),
      uWindMax: gl.getUniformLocation(updateProgram, 'uWindMax'),
      uDt: gl.getUniformLocation(updateProgram, 'uDt'),
      uTime: gl.getUniformLocation(updateProgram, 'uTime'),
      uSpeedScale: gl.getUniformLocation(updateProgram, 'uSpeedScale'),
    },
    draw: {
      uWindTex: gl.getUniformLocation(drawProgram, 'uWindTex'),
      uWindMin: gl.getUniformLocation(drawProgram, 'uWindMin'),
      uWindMax: gl.getUniformLocation(drawProgram, 'uWindMax'),
      uMaxSpeed: gl.getUniformLocation(drawProgram, 'uMaxSpeed'),
      uPointSize: gl.getUniformLocation(drawProgram, 'uPointSize'),
    },
    fade: {
      uPrevTex: gl.getUniformLocation(fadeProgram, 'uPrevTex'),
      uFadeFactor: gl.getUniformLocation(fadeProgram, 'uFadeFactor'),
    },
    composite: {
      uTrailTex: gl.getUniformLocation(compositeProgram, 'uTrailTex'),
    },
  };

  let lastTime = performance.now();

  function render(now) {
    resize();
    const dt = Math.min((now - lastTime) * 0.001, 0.05);
    lastTime = now;
    const elapsed = now * 0.001;

    gl.viewport(0, 0, canvas.width, canvas.height);

    // 绑定 GFS 风场纹理到 Texture Unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, windTexture);

    // Pass 1: Transform Feedback GPU 粒子平流更新（RK2）
    const nextParticleIdx = 1 - particleIdx;
    gl.useProgram(updateProgram);
    gl.uniform1i(locs.update.uWindTex, 0);
    gl.uniform2f(locs.update.uWindMin, windField.uMin, windField.vMin);
    gl.uniform2f(locs.update.uWindMax, windField.uMax, windField.vMax);
    gl.uniform1f(locs.update.uDt, dt);
    gl.uniform1f(locs.update.uTime, elapsed);
    gl.uniform1f(locs.update.uSpeedScale, 0.0018);

    gl.bindVertexArray(particles.vaos[particleIdx]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, particles.buffers[nextParticleIdx]);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    particleIdx = nextParticleIdx;

    // Pass 2: 将上一帧粒子拖尾衰减并叠加新粒子到当前 FBO
    const prevTrail = trailTargets[trailIdx];
    const currTrail = trailTargets[1 - trailIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, currTrail.fbo);
    gl.disable(gl.BLEND);

    gl.useProgram(fadeProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTrail.texture);
    gl.uniform1i(locs.fade.uPrevTex, 1);
    gl.uniform1f(locs.fade.uFadeFactor, 0.945);
    gl.bindVertexArray(fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 在拖尾图层上绘制本帧风场粒子
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(drawProgram);
    gl.uniform1i(locs.draw.uWindTex, 0);
    gl.uniform2f(locs.draw.uWindMin, windField.uMin, windField.vMin);
    gl.uniform2f(locs.draw.uWindMax, windField.uMax, windField.vMax);
    gl.uniform1f(locs.draw.uMaxSpeed, windField.maxSpeed);
    gl.uniform1f(locs.draw.uPointSize, Math.max(1.5, Math.min(window.devicePixelRatio || 1, 2) * 1.4));
    gl.bindVertexArray(particles.vaos[particleIdx]);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);

    // Pass 3: 绘制背景 GFS 风速标量场 + 等风速线，再叠加粒子拖尾
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.useProgram(scalarProgram);
    gl.uniform1i(locs.scalar.uWindTex, 0);
    gl.uniform2f(locs.scalar.uWindMin, windField.uMin, windField.vMin);
    gl.uniform2f(locs.scalar.uWindMax, windField.uMax, windField.vMax);
    gl.uniform1f(locs.scalar.uMaxSpeed, windField.maxSpeed);
    gl.bindVertexArray(fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(compositeProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, currTrail.texture);
    gl.uniform1i(locs.composite.uTrailTex, 1);
    gl.bindVertexArray(fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    trailIdx = 1 - trailIdx;
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

init();
