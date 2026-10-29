// 回放观感增强的客户端入口：把字幕轨的选择与投影交给学习页。
//
// 页面包不能把本包源码打进自己的 bundle（构建守卫不许内联本包 src/ 之外的文件），
// 所以这里单独成客户端包，学习页用 external import 在运行时拿到它。
//
// 与宿主半边（`src/index.js` 的 `zhiyunPlayback` 服务）是同一批函数：
// 页面渲染直接 import 更顺手（它有 `video-panel.jsx` 的同步渲染路径），
// 宿主侧别的插件仍走 `ctx.get`。两边不各写一份算法。
export const name = 'zhiyun-playback-client';
export const inject = [];
export function apply() {}

export {
  TRACK_KIND,
  resolveTrack,
  buildCues,
  activeIndex,
  burnLine,
  speechBands,
  isTailNoise,
  noiseStats,
} from './transcript.js';

export {
  ALIGNMENT_STATE,
  REFUSAL,
  matched,
  locatedOnly,
  refused,
  validateResult,
  indexAt,
  resolveAt,
} from './alignment.js';
