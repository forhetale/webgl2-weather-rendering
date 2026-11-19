# WebGL2 Weather Rendering

基于原生 **WebGL2** 的轻量级气象数据可视化与渲染实验仓库，聚焦 **NOAA GFS** 网格风场数据处理与实时 GPU 渲染管线。

## 当前已实现

- **GFS 风场网格编码与纹理上传（`src/gfsWindField.js`）**
  - `encodeGfsWindField`：接收 GFS U/V 浮点数组（`Float32Array`），完成 `0..360° -> -180..180°` 经度对齐、Y 轴翻转、缺测值过滤与 `RGBA8` 归一化打包，输出 `uMin/uMax/vMin/vMax` 解码元数据
  - `createSyntheticGfsWindField`：内置 1° 全球风场合成网格（360×181，含信风带、西风急流、Rossby 波与气旋/反气旋涡旋），开箱即可本地预览
  - `createWindTexture`：上传为 WebGL2 `RGBA8` 纹理（经度 `REPEAT`、纬度 `CLAMP_TO_EDGE`、双线性插值）
- **WebGL2 Transform Feedback 粒子平流管线（`src/main.js`、`src/shaders.js`）**
  - 在 GPU 上使用双缓冲 VBO + Transform Feedback 实时更新 24,000 个风场粒子（RK2 中点积分 + 寿命/边界重生）
  - 结合 Ping-Pong Framebuffer 渲染粒子流线拖尾
  - 同步采样 GFS 风场纹理绘制风速标量场色带、等风速线（Isotachs）与 30° 经纬参考网格

## 目录结构

```text
.
├── index.html           # 页面入口与 HUD
├── src/
│   ├── gfsWindField.js  # GFS U/V 网格编码、合成风场生成与 WebGL2 纹理上传
│   ├── main.js          # WebGL2 上下文初始化、Transform Feedback 与 Ping-Pong FBO 渲染循环
│   └── shaders.js       # GLSL ES 3.00 着色器（风场采样、TF 粒子平流、拖尾衰减与合成）
└── README.md
```

## 快速运行

零外部依赖，在项目根目录启动任意本地静态服务即可预览：

```bash
# Python 3
python -m http.server 8080

# 或 Node.js
npx serve .
```

随后在浏览器中访问 `http://localhost:8080`。

## GFS + WebGL2 后续计划

- [ ] **真实 GFS GRIB2 接入**：补充脚本将 NOAA GFS（GRIB2 / NetCDF）直接转为二进制或 PNG 纹理包，按时间步加载
- [ ] **地图投影与底图叠加**：支持 Web Mercator / 球面投影对齐，叠加海岸线矢量与交互缩放平移
- [ ] **多气象要素切换**：扩展海平面气压（PRMSL）、2m 温度（TMP）与降水率（PRATE）多图层渲染
