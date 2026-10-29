/**
 * 回放观感增强的**宿主半边**：本包只有纯函数，宿主侧没有行为。
 *
 * 但它必须作为 Loader entry 存在 —— 与 `dsh-zhiyun-core-player` 同一条理由：
 * bundle 被宿主 Loader 按条目加载，没有 `name` 的模块不是合法插件，放进
 * profile 会让**整个工作台起不来**（CONTRIBUTING 3.1）。
 *
 * # 两条腿
 *
 * | 半边 | 职责 |
 * |---|---|
 * | `transcript.js` | **字幕轨**：清洗句子替换原始碎片、尾噪条降级、烧进播放器的当前句 |
 * | `alignment.js` | **三态契约**：表达"这条时间可信 / 只是定位到 / 不可用" |
 *
 * `probe.js` 是离线诊断（Δ 探针），**不进生产链路**：实测 `course 86582`
 * 七节课的 Δ = 0（字幕与 PPT 同源同原点），所以当前没有偏移可校正。
 * 它留着是因为"这份时间轴能不能信"这个问题会反复出现，而探针能回答它。
 *
 * # 为什么 provide 服务而不是让消费方直接 import
 *
 * 页面包不能把本包源码打进自己的 bundle（构建守卫不许内联本包 `src/` 之外
 * 的文件，见 `tests/build-seeds.test.mjs`）。所以两条路：
 *
 * - 宿主侧：`ctx.get('zhiyunPlayback')` 拿同一批函数；
 * - 客户端：`src/client.jsx` 导出同一批（学习页视频栏 external import 它）。
 *   两边不各写一份算法。
 */

import {
  ALIGNMENT_STATE,
  REFUSAL,
  matched,
  locatedOnly,
  refused,
  validateResult,
  indexAt,
  resolveAt,
} from './alignment.js';
import {
  TRACK_KIND,
  resolveTrack,
  buildCues,
  activeIndex,
  burnLine,
  speechBands,
  isTailNoise,
  noiseStats,
} from './transcript.js';
import {
  PROBE_DEFAULTS,
  findPageTurnCues,
  probeDelta,
  suggestAnchors,
  tagSuspicion,
} from './probe.js';

export const name = 'zhiyun-playback';

/** 无宿主行为：本包只有纯计算。 */
export function apply(ctx) {
  return ctx.provide('zhiyunPlayback', {
    // 字幕轨
    TRACK_KIND,
    resolveTrack,
    buildCues,
    activeIndex,
    burnLine,
    speechBands,
    isTailNoise,
    noiseStats,
    // 三态契约
    ALIGNMENT_STATE,
    REFUSAL,
    matched,
    locatedOnly,
    refused,
    validateResult,
    // 投影
    indexAt,
    resolveAt,
    // 离线诊断
    probeDelta,
    suggestAnchors,
    findPageTurnCues,
    tagSuspicion,
    probeDefaults: PROBE_DEFAULTS,
  });
}
