// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位 —— 效法 packages/dsh-zhiyun-host-paper/src/upstream.js 的组织方式。
//
// 本文件**不含任何上游源码**，仅预留「把 opensheetmusicdisplay / osmd-audio-player
// 包成本仓可用的素材接口」的接缝。上游全部实现来自：
//   - opensheetmusicdisplay@2.2.1（BSD-3-Clause，https://github.com/opensheetmusicdisplay/opensheetmusicdisplay）
//   - osmd-audio-player@0.7.0（MIT，https://github.com/jimutt/osmd-audio-player）
//
// 设计原则（与 dsh-zhiyun-host-paper/src/upstream.js 一致）：
//   - 上游只被本文件 import，其余代码只依赖本文件导出的稳定接口；
//   - 上游 API 变更时，改动收敛在本文件内；
//   - 绝不复制上游实现进来。
//
// TODO（采用前必须完成）：
//   1. **版本错配必须先裁决**：osmd-audio-player@0.7.0 的 dependencies 声明
//      `opensheetmusicdisplay: ^0.8.4`（2020 年的旧大版本），而本骨架锁的是 2.2.1。
//      两条路：(a) 只装 2.2.1，osmd-audio-player 作为**同源升级的参考实现**
//      （其 PlaybackManager 约 300 行，但**不得搬运**，只按 MIT 记 ATTRIBUTION 后重写）；
//      (b) 用 npm overrides 强制统一到 2.2.1 并实测。**未实测前不得声称可用**。
//      本骨架默认按 (a) 出具，见 README「关键前置裁决」。
//   2. 确认 VexFlow 版本：osmd 2.2.1 自带 `vexflow@1.2.93`（1.x 的 fork），
//      与本仓若已有 VexFlow 消费方会**重复引入渲染引擎** → 须实测打包体积（osmd 解包约 2.3 MB）。
//   3. 音频：osmd-audio-player 依赖 `soundfont-player`，需要 Soundfont 源（CDN 或本地静态资源）。
//      **离线优先**是本仓原则 → 须确认静态资源随包发布的方式与体积上限；不可用时降级为「静音跟随」。
//   4. 确认 PlaybackManager 的 seek / cursor / measureIndex 接口与播放器时钟的对接方式。
//   5. 渲染失败（非法 MusicXML / 字体缺失）时返回可读错误并**整体移除容器**，不留空白。

// export const UPSTREAM = {
//   packages: [
//     { name: 'opensheetmusicdisplay', version: '2.2.1', license: 'BSD-3-Clause' },
//     { name: 'osmd-audio-player', version: '0.7.0', license: 'MIT' },
//   ],
// };

// TODO: 上游装配
// export async function loadRenderer(hostEl) { /* new OpenSheetMusicDisplay(hostEl, options) + load(xml) */ }

// TODO: 播放跟随（只读消费宿主时钟，不拥有播放状态）
// export function bindCursor(pm, playbackClock) { /* subscribe → cursor.next()/previous() + seek 回写 */ }
