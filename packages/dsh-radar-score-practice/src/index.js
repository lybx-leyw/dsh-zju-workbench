// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 入口占位 —— 本包负责「乐谱 → 可跟随播放的谱面块」的适配，**不含业务逻辑**。
//
// 设计边界（与 dsh-zhiyun-page-player / dsh-zhiyun-core-player 的分工）：
//   - dsh-zhiyun-page-player：「看课」页的版面（视频 / 课件 / 字幕同屏），本包**不新增页面**；
//   - dsh-zhiyun-core-player：播放统计（分段、语速热力），纯逻辑零 IO，本包**不接管其数据流**；
//   - 本包：只在「课件区"多一种可跟随的媒材"」这一处接缝上，提供 MusicXML 谱面
//     渲染 + 按播放头逐音高亮的素材层。**同一个面板，多一种素材类型**。
//
// TODO（采用前必须完成）：
//   1. 确认 dsh-zhiyun-page-player 是否已有「非视频素材」的挂载位；若没有，先提 issue 定接缝，
//      不要在本包里私开新页面。
//   2. 定义向下游暴露的最小接口（建议）：
//        mountScore(hostEl, musicXml, { playbackClock }) -> { seek(ms), currentMeasure(), destroy() }
//      其中 playbackClock 由播放器提供（只读消费），**本包不拥有播放状态**。
//   3. 素材来源裁决：课件区 PDF 内嵌的 MusicXML / 用户上传 .mxl；不接网络曲库。
//   4. 与 dsh-zhiyun-core-player 的时间轴单位对齐（ms 还是秒；见其 stats.js 的时间口径）。
//   5. 无谱面时整体降级：不渲染空容器、不占版面（宁可不出现，不要出现一个空盒子）。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

/** 插件名（与目录名、patch 的 id/name 一致）。 */
export const name = 'dsh-radar-score-practice';

/** 锁版凭据的快照（供评审对照；`relation` 等定性字段与凭据无关，仍写在这里）。 */
export const UPSTREAM = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  scope: '看课页 · 课件区补充「可跟随的乐谱素材」',
  relation: '强化式集成（同一面板 / 相似正交 / 换更优底层）',
};

/** 占位：上游装配与素材挂载都未实现。 */
export async function createScoreMaterial() {
  throw new Error('候选骨架：未实现（详见 src/upstream.js 的 TODO）');
}
