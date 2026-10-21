/**
 * 播放统计的**宿主半边**：本包提供的是纯函数，宿主侧没有行为。
 *
 * 但它**必须**作为 Loader entry 存在 —— 与 `dsh-zhiyun-ui-primitives` 同一条理由：
 * bundle 是被宿主 Loader 按条目加载的，没有 `name` 的模块不是合法插件，
 * 放进 profile 会让**整个工作台起不来**（CONTRIBUTING 3.1）。
 * 所以这里给一个只有名字、没有行为的插件。
 *
 * # 为什么提供空服务而不是什么都不做
 *
 * `ctx.provide('zhiyunPlayerStats', …)` 把纯函数挂成服务，
 * 让**将来的消费方**（页面包 / 别的插件）经 `ctx.get` 就能拿到，
 * 不必知道这些函数住在哪个文件的哪条相对路径上。
 * 这与本仓其他领域包的形状一致（`zhiyunNotes` / `zhiyunQuiz` / `zhiyunKnowledge` …）。
 *
 * # 消费方
 *
 * 学习页视频栏经客户端包拿到同一批函数（`src/client.jsx`），画在回放下面。
 * 宿主侧别的插件仍然 `ctx.get('zhiyunPlayerStats')`，不必改这里。
 */

import {
  computeSectionStats,
  buildContentSegments,
  buildSpeedBuckets,
  countKnowledgePoints,
  countChars,
  toSeekBar,
  STATS_MERGE_GAP_SEC,
} from './stats.js';

export const name = 'zhiyun-player-stats';

/** 无宿主行为：本包只有纯计算。 */
export function apply(ctx) {
  return ctx.provide('zhiyunPlayerStats', {
    computeSectionStats,
    buildContentSegments,
    buildSpeedBuckets,
    countKnowledgePoints,
    countChars,
    toSeekBar,
    mergeGapSec: STATS_MERGE_GAP_SEC,
  });
}
