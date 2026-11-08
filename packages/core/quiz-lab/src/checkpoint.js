/**
 * r4 lab 的检查点版本与迁移边界。
 *
 * # 两个版本号，不要混用
 *
 * - `CHECKPOINT_VERSION`（本文件）：**产品侧**「这份断点归谁解析」。
 *   它住在这里而不是 core-quiz 的 `versions.json`，因为那张表是
 *   `measuredSha256` / `promotedSha256` 的证书表 —— 只收被测量过的内核。
 * - `KERNEL_VERSION`（`kernel/run.mjs` 的 `r4-demand-v3`）：r4 **内部**格式版本。
 *
 * # 版本不符时拒绝恢复，不尝试兼容
 *
 * r4 的检查点里存的是账本、资产快照和 toolStages。用旧格式去读新内核，
 * 最温和的结果是静默丢题，最坏的结果是把旧资产当成新题的来源复用。
 * 两种情况都不会抛错 —— 所以这里必须显式拒绝，让用户看到「断点已过期」，
 * 而不是拿到一批看起来没问题、来源其实错乱的题。
 */

import {CHECKPOINT_VERSION} from './engine.js';

export const LAB_CHECKPOINT_VERSION = CHECKPOINT_VERSION;

/** 判断一份产品检查点是否属于本引擎、且版本能读。 */
export function canResumeLab(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return false;
  if (checkpoint.version !== LAB_CHECKPOINT_VERSION) return false;
  if (checkpoint.engineState?.kernel !== 'r4-lab') return false;
  const lab = checkpoint.engineState?.lab;
  return Boolean(lab) && typeof lab === 'object';
}

/** 版本不符时给出的可操作原因（而不是一句「断点无效」）。 */
export function resumeRefusal(checkpoint) {
  if (!checkpoint) return '没有可恢复的断点';
  if (checkpoint.version !== LAB_CHECKPOINT_VERSION) {
    return `这份断点属于另一个版本的 r4 lab（记录为 ${checkpoint.version ?? '缺失'}，当前为 ${LAB_CHECKPOINT_VERSION}），不能续跑；已生成的题目仍保留在题库中`;
  }
  if (checkpoint.engineState?.kernel !== 'r4-lab') return '这份断点不是 r4 lab 产生的，不能由本引擎续跑';
  return null;
}
