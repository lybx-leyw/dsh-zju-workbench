/**
 * 上游封装占位（候选骨架 · 未评审 · 不可直接使用）。
 *
 * # 上游是谁
 *
 * | 项 | 值 |
 * | --- | --- |
 * | 仓库 | https://github.com/liyupi/dsh-kun-like-pet |
 * | 版本 | **`1.0.0`**（锁版；`package.json` 里 `private: false`，但**无 npm 发布记录**） |
 * | 许可证 | **MIT** ✅（`LICENSE` 首行 `MIT License`，`Copyright (c) 2026 liyupi`；GitHub `license.spdx_id = MIT` 一致） |
 * | 形态 | **DSH 动态插件**（`cordis_define` 的 `code.host` + `code.client`），**不是**可 install 的 npm 包 |
 * | 星标 / 活跃 | ★113 · `pushed 2026-08-14`（约 3 个月无推送） |
 * | 体积 | `src/host.js` 12185 B + `src/client.js` 10493 B；`assets/spritesheet.webp` **2079622 B**、`assets/voice.mp3` 32539 B |
 *
 * # 为什么「锁版」在这里不等于「npm 锁版」
 *
 * 本仓其它 A 类骨架的 `dependencies` 写的都是能在 npm 上查到的版本号。
 * 这个上游**不是那种包**：它的安装方式是「把两个字符串粘进 `cordis_define`」。
 * 所以 `package.json` 里的 `"dsh-kun-like-pet": "1.0.0"` 只是**愿望**，
 * 评审第一步就要验证它能否真的装上；不能装就清空该依赖。
 *
 * # 上游可借的只有一样东西
 *
 * `client.js` 顶部那张 `ROWS` 帧表（8 列 × 9 行，每行状态名 + 帧数 + 每帧毫秒）。
 * 那是**数据**，不是逻辑，抄成本仓常量是合理的（MIT，且已在 `ATTRIBUTION.md` 记名）。
 *
 * # 明确**不**借的三样
 *
 * | 不借 | 原因 |
 * | --- | --- |
 * | `shell.overlay` 全局挂载 | 本仓规划页已有 pet，全局再叠一个是重复 |
 * | `host.js` 的系统命令放音（`afplay` / `SoundPlayer` / `ffplay`） | 跨平台 `child_process` + 绝对路径入参 = 供应链风险面，且需求未获确认 |
 * | `agents` 服务 500ms 轮询 | 本仓 pet 已有自己的事件流（`pet-stream.js`），再轮询一套是两处真相 |
 */

/** 上游版本，锁死。改它之前先确认 npm 上真的有这一版。 */
export const UPSTREAM_VERSION = '1.0.0';

/** 上游仓库地址（只作记录，不做运行时 fetch）。 */
export const UPSTREAM_REPO = 'https://github.com/liyupi/dsh-kun-like-pet';

/**
 * 上游 `client.js` 的 9 行动画契约 —— **仅登记，未搬运**。
 *
 * 骨架阶段刻意不把帧数据写进本仓：一旦写进来，就等于替评审做完了「要不要这份素材」
 * 的决定。评审通过后才允许把需要的 4 行抄成 `assets/` 下的自有常量。
 */
export const UPSTREAM_ROWS = Object.freeze([
  'idle', 'runRight', 'runLeft', 'wave', 'jump', 'failed', 'waiting', 'working', 'review',
]);

/**
 * 本仓已有 pet 需要的状态 → 上游 9 行里的对应行。
 *
 * 只映射 4 个：本仓的 pet 只需要表达「在想 / 在写 / 等确认 / 出错」，
 * 跑步（`runRight`/`runLeft`）与挥手（`wave`）依赖拖动交互，本仓不做。
 */
export const STATE_TO_ROW = Object.freeze({
  idle: 'idle',
  working: 'working',
  waiting: 'waiting',
  failed: 'failed',
});

/**
 * 骨架占位：读上游帧表。
 *
 * @throws 永远抛出 —— 骨架不该被任何真实代码调用。
 */
export function loadFrameTable() {
  throw new Error(
    '[radar-pet-overlay] 骨架：loadFrameTable() 未实现。先确认 dsh-kun-like-pet@1.0.0 的安装形态，再决定内联还是依赖。',
  );
}

/**
 * 骨架占位：把本仓 pet 的状态翻成上游行名。
 *
 * @throws 永远抛出 —— 骨架不该被任何真实代码调用。
 */
export function toRow(_state) {
  throw new Error(
    '[radar-pet-overlay] 骨架：toRow() 未实现。映射表见 STATE_TO_ROW，但不许在骨架里就直接用。',
  );
}
