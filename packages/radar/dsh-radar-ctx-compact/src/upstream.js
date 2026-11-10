/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-radar-paper-union/src/upstream.js` 与 `dsh-radar-kb-rag/src/upstream.js`：
 *
 *   1. `package.json` 的依赖写**精确版本**（`0.14.0`，不是 `^0.14.0`）；
 *   2. 运行时再核对一次真实安装的版本（别人的 lockfile / `npm link` 能让声明的版本失真）；
 *   3. 锁版这件事必须有一条会红的校验 —— 本骨架**尚未**带测试（且按 skill 规定
 *      radar 包内**不得**有测试），评审通过后由维护者在 `tests/` 下另行补。
 *
 * ── 这个包为什么是「强化式集成」而不是「全新功能」───────────────────
 *
 * 「压缩上下文」这件事**一直存在**：宿主自带 `@deepseek-ai/dsh-compaction-basic`，
 * 每次压缩调 1 次 LLM，把旧对话**重新总结**一遍。
 *
 * 缺的不是「压缩」这个动作，而是**这个动作的更优实现**。上游给的就是这个：
 *
 *   官方 compaction-basic          @aiwayds/dsh-dcp
 *   ─────────────────────────      ────────────────────────────
 *   每次压缩 1 次 LLM 调用          0 次 LLM 调用
 *   同对话多次压缩结果可能不同       相同输入永远相同
 *   语义归纳（模型转写）            逐字抽取五段事实
 *   中文按 4 字符/token 低估        按 CJK 真实密度（≈2 字符/token）计价
 *
 * ⇒ 三条判据：
 *   ① 仍是同一个面板 —— 上游 patch **不新增面板、不新增导航项、不新增斜杠命令**
 *      （README「Not in scope」原文：`/compact` 与检查点卡片显式不做，因为宿主自带）。
 *      它做的是把同一个压缩接口的**后端**换掉。
 *   ② 功能仍相似正交 —— 同一动作、同一输出格式（上游明写「检查点格式：官方，兼容可互相合并」），
 *      正交的是**实现方式**（确定性抽取 vs LLM 归纳）。
 *   ③ 底层多调了更优质实现 —— 本仓 `grep -rn "compaction" packages/` **0 命中**，
 *      连一行压缩策略都没有。上游是一个经 21 个版本迭代的确定性压缩器，
 *      「零 LLM + 可复现 + CJK 计价」这三条**不可能**靠本仓几十行自研追平。
 *
 * ── 四条必须先解决的风险（评审别重查，直接看这里）──────────────────
 *
 *   R-1【阻塞·版本线】本仓 `runtime.lock.json` 明写
 *       `preferredHostVersion: 0.2.2-rc.1` 且「currently targets **0.2.2-rc.1 only**」。
 *       上游 peer 是**十余个** `@deepseek-ai/*` 子包（compaction / compaction-basic /
 *       compaction-tool-result-pruner / session / llm / token-meter / agent / brand /
 *       commands / invariants / skill / cordis / schemastery），全部 `>=0.2.0-rc.2`。
 *       **同一发行线 ≠ 同一版本**：必须在本仓那一个宿主版本上**实装验证**，
 *       不能只读 semver 范围就放行。不过 → 直接驳回。
 *
 *   R-2【阻塞·无回退】上游 patch **无条件** `disabled: true` 掉 compaction-basic。
 *       挂上就没有官方压缩可退。本包的 patch 因此**不抄那一行**（见 cordis.patch.yml）。
 *       评审要拍板：是「必须替换」还是「两者并存由用户选」。
 *
 *   R-3【阻塞·语义损失】上游自述**不做语义归纳**：只保留「出现过的事实」
 *       （Primary Request / Files and Code / Errors and Fixes / Pending Jobs / Critical Context），
 *       不「理解」对话在讨论什么。对本仓「规划页 / 论文页」这类**需要跨轮理解意图**的
 *       场景，这是**真实的功能退化**，不只是格式不同。
 *       ⇒ 评审必须拿真实会话（中文论文精读 + 英文刷题复盘各一段）做 A/B，
 *       确认压缩后模型**仍能接上任务**、Pending Jobs 不漏项。漏项 → 驳回。
 *
 *   R-4【锁版】npm 上存在 `0.0.0-stage` 占位版本；`dist-tags.latest` 已是 `0.14.0`。
 *       锁 `0.14.0` 精确版本。另：仓库 `package.json` 的 version 与 npm 一致（0.14.0，
 *       2026-11-10 实查），不存在 paper-union 那种「tag 与 npm 岔开」的问题。
 *
 * ── 与本仓另外两个 context-* 骨架的关系（别混为一谈）──────────────────
 *
 *   dsh-radar-context-dashboard  上下文**构成分解**（谁占了多少）  —— 观测
 *   dsh-radar-context-lens       上下文**成本归因**（哪个插件贵）  —— 观测
 *   dsh-radar-ctx-compact        上下文**压缩后端**（怎么压）      —— 动作 ← 本包
 *
 *   前者们回答「代价是什么」，本包回答「代价怎么降下来」。**不重叠**。
 */

export const UPSTREAM_PACKAGE = '@aiwayds/dsh-dcp';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.14.0';

/** 上游发布源头（npm `repository` 指向 GitHub，2026-11-10 实查）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/fan56/dsh-dcp';

/** 上游许可证。Apache-2.0 —— 宽松白名单内，可以锁版引入。 */
export const UPSTREAM_LICENSE = 'Apache-2.0';

/**
 * 上游的挂载形状：`dsh.bundle.patch: ./cordis.patch.yml`，**无 `dsh.client`**。
 * 即纯宿主侧插件，不注入任何 UI 分包 —— 这正是判据①（不新增面板）的物理依据。
 */
export const UPSTREAM_MANIFEST = { bundlePatch: './cordis.patch.yml', client: null };

/** 上游运行时依赖：空对象（`dependencies: {}`，21 个版本里最新一版实查）。零传递污染。 */
export const UPSTREAM_RUNTIME_DEPENDENCIES = [];

/**
 * 上游 peer 依赖的后缀白名单。**只用来判断「装不装得上」**，不是兼容性证明 ——
 * R-1 说的就是这件事：范围宽不代表在本仓那个版本上真能跑。
 */
export const UPSTREAM_PEER_PREFIXES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/schemastery',
];

/** 上游 patch 里被 `disabled: true` 掉的官方包 —— 本包**不抄**这一行，见 R-2。 */
export const UPSTREAM_DISABLES = ['@deepseek-ai/dsh-compaction-basic'];

/** 上游 patch 的默认配置（只读参考，评审据此决定本仓该填什么）。 */
export const UPSTREAM_DEFAULT_CONFIG = { thresholdRatio: 0.7, language: 'zh' };

/** 上游「不做」的清单（README「Not in scope」），判据① 的直接出处。 */
export const UPSTREAM_NOT_IN_SCOPE = [
  '不做语义归纳（只保留出现过的事实）',
  '不重复做工具结果剪枝（留给 compaction-tool-result-pruner）',
  '不重做触发策略 / 保留尾巴 / 溢出恢复（继承官方）',
  '不新增 /compact 命令与检查点卡片（宿主自带）',
];

/**
 * 延迟 import 上游入口。**只在评审通过后调用**，且必须走这一个函数 ——
 * 不允许在别处直接 `import('@aiwayds/dsh-dcp')`，否则锁版核对会被绕过。
 */
export async function loadUpstream() {
  throw new Error(
    'dsh-radar-ctx-compact 是候选骨架，未评审。' +
      '评审通过后在这里实现：先校验安装版本 === UPSTREAM_VERSION，再 return import(UPSTREAM_PACKAGE)。',
  );
}
