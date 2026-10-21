/**
 * dsh-radar-context-lens —— 候选骨架（占位，**不含业务逻辑**）。
 *
 * # 这个包要做什么
 *
 * 把上游 `dsh-context-lens`（MIT，npm `0.3.1`）**锁版挂载**进来，为「插件」页
 * （`dsh-zhiyun-page-plugins`）补上它当前**结构性缺失**的那一半视角：
 *
 *   - 插件页**已有**：依赖关系（谁 inject 谁、谁是叶包）—— 见该包 README
 *     「只读宿主那棵树的依赖事实，不解析源码、不扫目录」。
 *   - 插件页**没有**：每个插件往模型请求里**塞了多少**（token 占比、KV cache 命中、
 *     相邻两次请求的增删改）。
 *
 * 缺的这半边正是「我不用论文，能不能把论文那一整块关掉」的**成本依据** ——
 * 但目前只能看到「论文包依赖了解析包」，看不到「论文包占了 18% 上下文」。
 *
 * # 集成方式（A 类 · 锁版挂载 + 外围兼容层）
 *
 * 效法 `packages/dsh-zhiyun-host-paper`（上游 `@ggboy123/dsh-paper-reader` 锁版 `1.3.1`）：
 * **绝不改上游源码**，只在上游之外加适配。上游自带 `dsh.bundle.patch`，是原生 DSH 插件包。
 *
 * # TODO（真正的适配点，评审前不要实现）
 *
 * 1. **挂载入口**：上游 `patch` 会插入它自己的 Lens 视图（在 Chat / Trajectory 旁）。
 *    需确认它与本仓 `dsh-zhiyun-shell-workbench` 的会话区是否冲突 —— 冲突则改为只挂宿主半边、
 *    由本包把读数喂给插件页（见 `./upstream.js`）。
 * 2. **数据出口**：上游是 read-only 观测，**与插件页「不另开写入口」的边界一致**。
 *    若要复用，读它的 public API 即可，**不要**在插件页加写操作。
 * 3. **样式**：上游复用 DSH Web 的 `--dsw-*` design tokens；本仓页面用 `zpl-` 前缀。
 *    需确认两套 token 在同一页面共存时的层序（参考 `dsh-zhiyun-page-plugins` README
 *    的「层序与依赖序是两件事」）。
 * 4. **Node 版本前置条件**：上游 `engines.node >= 20.19.0`，本仓要求
 *    `^22.19.0 || >=24.0.0` —— 取本仓更严者，**无需**放宽。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_REPOSITORY,
  UPSTREAM_LICENSE,
} from './upstream.js';

export const name = 'dsh-radar-context-lens';

/** 占位：本骨架**不实现任何业务逻辑**，仅登记元信息供评审。 */
export const RADAR_SKELETON = {
  status: 'candidate-skeleton',
  reviewed: false,
  wiredIntoProfile: false,
  upstream: UPSTREAM_PACKAGE,
  upstreamVersion: UPSTREAM_VERSION,
  upstreamLicense: UPSTREAM_LICENSE,
  upstreamRepo: UPSTREAM_REPOSITORY,
  integration: 'A · 锁版挂载 + 外围兼容层',
  enhances: 'dsh-zhiyun-page-plugins（插件页）的「依赖图」→ 补「上下文成本」',
};

export function apply() {
  throw new Error(
    'dsh-radar-context-lens 是候选骨架，尚未实现。见 README.md 与 ./upstream.js 的 TODO。',
  );
}

export default { name, apply };
