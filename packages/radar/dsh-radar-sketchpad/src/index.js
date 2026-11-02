/**
 * dsh-radar-sketchpad —— 候选骨架的**宿主侧**。
 *
 * ⚠ 未评审 · 未接入 profile · 不可直接使用。apply() 只打一行日志。
 *
 * 形状：A 类「锁版挂载 + 外围兼容层」。
 *   - 上游 `dsh-sketchpad@0.1.1` 由 dependencies 锁版引入，一行源码都不改；
 *   - 「课堂页里画一段」的入口由本包的外围层注册（见 src/upstream.js 的 TODO）；
 *   - 不注册页面、不注册工具、不读不写任何存储。
 */
import { SKETCHPAD_VERSION, describeCompatSurface } from './upstream.js';

export const name = 'dsh-radar-sketchpad';

export function apply(ctx) {
  // 评审通过前不挂任何东西。只把「将来要挂在哪」写进日志，便于评审时对照。
  ctx?.logger?.info?.(
    `[dsh-radar-sketchpad] 候选骨架，未评审：将锁版挂载 dsh-sketchpad@${SKETCHPAD_VERSION}` +
      `（${describeCompatSurface()}）。`,
  );
}
