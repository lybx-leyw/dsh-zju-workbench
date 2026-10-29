/**
 * 出题实验室的宿主半边：把 r4 注册成一个可挂载的出题引擎。
 *
 * # 为什么注册项而不是改产品
 *
 * 从 r4 起，实验引擎不再演进入 `dsh-zhiyun-core-quiz` 的内核。
 * 那条路的代价是 `versions.json`：它用 `measuredSha256` / `promotedSha256`
 * 记录「这段代码被测量过」，登记一个未测量的内核等于给它发证书，
 * 之后每次改结构都要走重测流程。注册表让 lab 自带 `checkpointVersion`，
 * 产品内核的证书表因此不被稀释。
 *
 * # 卸载为什么是干净的
 *
 * `apply` 返回的就是注销函数。lab 被关掉时 Cordis 调用它，
 * `engine-registry` 的模块级表随之回到空 —— 引擎按钮消失、
 * 纯函数对 `r4-lab` 重新返回 `null`（不可规划、不可恢复）。
 * 已生成的题目留在题库里，`engineLabel` 会显示「已卸载的出题引擎」，
 * 而不是把它静默当成 r1。
 */

import {LAB_ENGINE, createLabRun} from './engine.js';

export const name = 'zhiyun-quiz-lab';

/**
 * 硬依赖 `zhiyunQuiz`：注册表挂在它上面（见 core-quiz 的 `service.engines`）。
 *
 * Cordis 的 `Inject` 只有必需注入（`registry.d.ts` 里没有可选形态），
 * 所以这里无法写成「有则用、无则跳过」。这是可接受的：没有注册表的机器上，
 * 本包本来也无处注册。反过来 core-quiz **不**依赖本包 —— 方向是单向的。
 */
export const inject = ['zhiyunQuiz'];

export function apply(ctx) {
  const registry = ctx.zhiyunQuiz?.engines;
  if (!registry || typeof registry.register !== 'function') {
    throw Object.assign(Error('当前 core-quiz 没有暴露引擎注册表（zhiyunQuiz.engines），出题实验室无处注册'), { code: 'CONFIG' });
  }
  const unregister = registry.register({...LAB_ENGINE, createRun: createLabRun});
  return () => {
    if (typeof unregister === 'function') unregister();
  };
}
