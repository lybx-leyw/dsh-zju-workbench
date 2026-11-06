/**
 * dsh-zhiyun-classroom-geometry —— 课堂几何内核包的**入口**。
 *
 * 本文件不含任何逻辑：上游 `@openmaic/geometry@0.1.0` 的构建产物被原样 vendored
 * 到 `../vendor/geometry/`，这里只做一次 re-export。纯函数（SVG path 解析与形状几何
 * 校验、形状文字回退），无 React、无 IO。
 *
 * 来源：https://github.com/THU-MAIC/OpenMAIC
 * commit 0ae3215e965412b8ee536feaa5d98f75b7a70923 · MIT · 见 ATTRIBUTION.md
 */
export * from '../vendor/geometry/index.js';
