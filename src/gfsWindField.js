/**
 * GFS (Global Forecast System) 风场网格数据处理与 WebGL2 纹理编码模块
 *
 * 支持：
 * 1. 将真实 GFS GRIB2 解码后的 Float32Array (UGRD / VGRD) 网格打包为 WebGL2 RGBA8 纹理
 *    - 经度 0..360° 自动对齐到 -180..180°（便于常见地理底图/全屏经纬度渲染）
 *    - R 通道存储归一化 U 分量，G 通道存储归一化 V 分量，B 通道存储归一化风速标量
 * 2. 提供符合地球大气环流特征的合成 GFS 网格生成器，便于无外部数据文件时直接本地预览
 */

/**
 * 将 GFS U/V 浮点数组编码为 WebGL2 可直接线性采样的 RGBA8 纹理数据
 * @param {object} params
 * @param {number} params.width 经度方向网格数（如 360 表示 1° 分辨率）
 * @param {number} params.height 纬度方向网格数（如 181 表示 90°N ~ 90°S）
 * @param {Float32Array} params.uData 纬向风 U 分量 (m/s)，按行主序排列
 * @param {Float32Array} params.vData 经向风 V 分量 (m/s)，按行主序排列
 * @param {boolean} [params.shiftLon180=true] 是否将 GFS 默认 0..360° 经度平移至 -180..180°
 */
export function encodeGfsWindField({ width, height, uData, vData, shiftLon180 = true }) {
  const count = width * height;
  if (uData.length !== count || vData.length !== count) {
    throw new Error(`GFS grid size mismatch: expected ${count}, got U=${uData.length}, V=${vData.length}`);
  }

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let maxSpeed = 0;

  for (let i = 0; i < count; i++) {
    const u = Number.isFinite(uData[i]) ? uData[i] : 0;
    const v = Number.isFinite(vData[i]) ? vData[i] : 0;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    const speed = Math.hypot(u, v);
    if (speed > maxSpeed) maxSpeed = speed;
  }

  const uSpan = Math.max(uMax - uMin, 1e-5);
  const vSpan = Math.max(vMax - vMin, 1e-5);
  const speedSpan = Math.max(maxSpeed, 1e-5);

  const pixels = new Uint8Array(count * 4);
  const halfWidth = Math.floor(width / 2);

  for (let y = 0; y < height; y++) {
    // WebGL 纹理 V=0 在底部，GFS 网格第 0 行在北纬 90°，翻转 Y 轴使其与屏幕坐标一致
    const dstY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcX = shiftLon180 ? (x + halfWidth) % width : x;
      const srcIdx = y * width + srcX;
      const dstIdx = (dstY * width + x) * 4;

      const u = Number.isFinite(uData[srcIdx]) ? uData[srcIdx] : 0;
      const v = Number.isFinite(vData[srcIdx]) ? vData[srcIdx] : 0;
      const speed = Math.hypot(u, v);

      pixels[dstIdx + 0] = Math.round(((u - uMin) / uSpan) * 255);
      pixels[dstIdx + 1] = Math.round(((v - vMin) / vSpan) * 255);
      pixels[dstIdx + 2] = Math.round((speed / speedSpan) * 255);
      pixels[dstIdx + 3] = 255;
    }
  }

  return {
    width,
    height,
    uMin,
    uMax,
    vMin,
    vMax,
    maxSpeed,
    pixels,
  };
}

/**
 * 生成一份模拟 GFS 1° 全球风场网格（包含中纬度西风急流、低纬信风带及多个气旋/反气旋涡旋）
 */
export function createSyntheticGfsWindField(width = 360, height = 181) {
  const count = width * height;
  const uData = new Float32Array(count);
  const vData = new Float32Array(count);

  // 预设若干模拟低压气旋 / 高压反气旋系统（lonDeg, latDeg, strength, radiusDeg）
  const vortices = [
    { lon: 145, lat: 32, strength: 26, radius: 22 },  // 西北太平洋气旋
    { lon: 315, lat: 46, strength: 24, radius: 26 },  // 北大西洋低压
    { lon: 210, lat: -38, strength: -22, radius: 24 }, // 南太平洋气旋
    { lon: 95, lat: 22, strength: -16, radius: 20 },  // 亚洲大陆高压脊
    { lon: 20, lat: -28, strength: 18, radius: 22 },  // 南大西洋高压
  ];

  for (let y = 0; y < height; y++) {
    const latDeg = 90 - (y / (height - 1)) * 180;
    const latRad = (latDeg * Math.PI) / 180;

    // 行星尺度背景风带：赤道东风信风 + 中纬度西风急流 + 极地东风
    const tradeWind = -11.0 * Math.exp(-Math.pow(latDeg / 20.0, 2));
    const jetStreamN = 24.0 * Math.exp(-Math.pow((latDeg - 42.0) / 14.0, 2));
    const jetStreamS = 26.0 * Math.exp(-Math.pow((latDeg + 46.0) / 15.0, 2));
    const zonalBase = tradeWind + jetStreamN + jetStreamS;

    for (let x = 0; x < width; x++) {
      const lonDeg = (x / width) * 360;
      const lonRad = (lonDeg * Math.PI) / 180;

      // Rossby 波动扰动
      let u = zonalBase + 5.5 * Math.cos(3.0 * lonRad + latRad * 2.0) * Math.cos(latRad);
      let v = 6.5 * Math.sin(4.0 * lonRad - latRad * 1.5) * Math.cos(latRad);

      // 叠加局地涡旋切向风场
      for (const vortex of vortices) {
        let dLon = lonDeg - vortex.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const dLat = latDeg - vortex.lat;
        const distSq = dLon * dLon + dLat * dLat;
        const rSq = vortex.radius * vortex.radius;
        const falloff = Math.exp(-distSq / (2.0 * rSq));
        const dist = Math.sqrt(distSq) + 1.5;

        // 切向风 (-dLat, dLon) / dist
        u += (-dLat / dist) * vortex.strength * falloff;
        v += (dLon / dist) * vortex.strength * falloff;
      }

      const idx = y * width + x;
      uData[idx] = u;
      vData[idx] = v;
    }
  }

  return encodeGfsWindField({ width, height, uData, vData, shiftLon180: true });
}

/**
 * 将编码后的 GFS 风场数据上传为 WebGL2 纹理
 */
export function createWindTexture(gl, windField) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    windField.width,
    windField.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    windField.pixels
  );

  // 经度方向环绕，纬度方向钳制
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}
