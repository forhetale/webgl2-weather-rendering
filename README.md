# webgl2-weather-rendering

自己折腾的一个原生 WebGL2 气象风场渲染小项目，打算用来跑 NOAA GFS 网格数据。

没引任何前端框架和渲染库，就是纯 WebGL2 + GLSL ES 3.00，目前先搭了个最小可运行的风场原型。

## 现在里面有什么

- `src/gfsWindField.js`：把 GFS 的 U/V 浮点网格数据打包成 `RGBA8` 纹理（处理了 0~360° 经度平移和 Y 轴翻转）。手头没接真实 GRIB2 文件的时候，默认先用一份 360×181 的合成风场顶着跑效果。
- `src/shaders.js` & `src/main.js`：用 WebGL2 Transform Feedback 在 GPU 上跑 24,000 个风场粒子的 RK2 平流，配双 FBO 做拖尾，底层叠了一层风速标量色带、等风速线和 30° 经纬网。
- `index.html`：单页入口，起个静态服务就能看。

## 本地跑一下

```bash
python -m http.server 8080
```

打开 `http://localhost:8080` 就行。

## 后面打算补的

- 写个预处理脚本把真实 GFS GRIB2 / NetCDF 数据切出来，直接喂给现在的纹理管线
- 加上墨卡托 / 球面投影和海岸线底图，支持缩放拖动
- 补温度、气压、降水这些标量图层切换
