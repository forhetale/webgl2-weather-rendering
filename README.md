# WebGL2 Weather Rendering

基于原生 **WebGL2** 的轻量级气象数据可视化与渲染实验仓库，用于探索气象标量场（温度、气压、降水等）与矢量场（风场流线/粒子）的实时 GPU 渲染管线。

## 当前内容

- 原生 WebGL2 全屏渲染管线初始化与着色器编译工具（`src/main.js`）
- GLSL ES 3.00 示例着色器（`src/shaders.js`）：程序化气象标量场（模拟气压/温湿度场分布）与等值线、气象色带（Colormap）实时映射
- 零外部依赖，可直接通过本地静态服务器打开预览

## 目录结构

```text
.
├── index.html       # 页面入口与 Canvas 容器
├── src/
│   ├── main.js      # WebGL2 上下文初始化与渲染循环
│   └── shaders.js   # GLSL ES 3.00 顶点与片元着色器
└── README.md
```

## 快速运行

在项目根目录启动任意本地静态服务即可预览：

```bash
# Python 3
python -m http.server 8080

# 或 Node.js
npx serve .
```

随后在浏览器中访问 `http://localhost:8080`。

## 后续计划

- [ ] 接入真实气象网格数据（如 GeoJSON / GRIB2 预处理后的浮点纹理）
- [ ] 基于 Ping-Pong Framebuffer 的 GPU 风场粒子平流渲染
- [ ] 支持多图层叠加与色带交互配置
