/**
 * dsh-radar-plugin-trim —— 候选骨架，未评审。
 *
 * 做的事情：把上游 `dsh-plugin-trim` 锁版挂载进来，为「插件」页
 * （`packages/client/page-plugins`）补上**上下文成本**与**冲突**两列，
 * 让「要不要关掉这个插件」从主观判断变成可解释的账。
 *
 * 本文件只做三件事：
 *   1. 声明包的身份；
 *   2. 提供 `apply()` 占位（当前只打日志，**不注册任何服务、不改任何行为**）；
 *   3. 把 TODO 列清楚，供评审逐条裁定。
 *
 * ⚠ 这里刻意不 import 上游 —— 骨架阶段任何 `import` 都可能让宿主在
 *    profile 里误加载它。真正的接入点见 TODO-1。
 */

/** 包名，和 package.json 的 `name` 必须一致。 */
export const name = 'dsh-radar-plugin-trim';

/** 上游锁版坐标（单一真源在 src/upstream.js，这里只引用不复制）。 */
export const UPSTREAM = 'dsh-plugin-trim@0.2.2';

/**
 * Cordis 插件入口。骨架阶段**只打日志**。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文
 * @returns {void}
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    `[${name}] 候选骨架已加载（仅占位，未注册任何服务）。` +
      `上游 ${UPSTREAM} 尚未接入，详见 README 与下方 TODO。`,
  );
}

/*
 * ───────────────────────── TODO（评审逐条裁定） ─────────────────────────
 *
 * TODO-0  **先解决版本真值**（阻塞项）
 *         README 主推 GitHub Release `.tgz`，npm 上是否真的有 `dsh-plugin-trim@0.2.2`
 *         未实测。若只有 Release 包，`package.json` 的 `dependencies` 必须改成
 *         tarball URL，否则 `pnpm i` 直接失败。
 *
 * TODO-1  接入方式二选一，且必须二选一，不许折中：
 *         (a) 整包挂载：`ctx.plugin(await import('dsh-plugin-trim'))`；
 *         (b) 只取计算模块：`import { analyze } from 'dsh-plugin-trim/…'`，UI 用本仓插件页。
 *         倾向 (b) —— 见 TODO-2。
 *
 * TODO-2  **判据①的前置条件（硬）**：上游自带「设置 → 插件 → 体验优化」页签。
 *         若 (a) 会让它注册成独立导航项，则判据①不成立，方案作废，只能走 (b)。
 *         评审须先在宿主里实测上游是否自动挂导航。
 *
 * TODO-3  成本模型对齐：上游的「上下文成本」是 token 估算。本仓
 *         `dsh-radar-context-dashboard` 已有一套上下文占用口径。
 *         两套数必须**同一口径**，否则插件页说 3k、仪表盘说 5k，比不说更糟。
 *
 * TODO-4  与现有五个插件画像骨架的边界（防「重复且无增益」）：
 *         `plugin-audit`（权限）/ `plugin-caps`（能力）/ `plugin-graph`（依赖）/
 *         `plugin-score`（评分）/ `plugin-ledger`（账本）。
 *         本包**只追加**成本与冲突两列，且**消费**前两者的输出，不自建清单。
 *         若评审发现它自带一套完整插件清单 UI，驳回。
 *
 * TODO-5  「显式应用 + 一键回滚」的落点：上游是改 profile 的 bundles。
 *         本仓 skill 硬规则是 **radar 包不写 profile**。因此该动作只能由
 *         **用户在插件页上主动点**触发，绝不能是本包启动时的自动行为。
 *         评审需确认上游是否默认开启任何自动裁剪。
 *
 * TODO-6  冲突判定的误报率：上游的 compatibility 规则见其 docs/compatibility.md。
 *         学生机器上常见的冲突源（同名命令、抢占 settings 段）须先跑一遍真实清单。
 *
 * TODO-7  体积与依赖：上游把 `dsh-shared-meta` 构建期内联（不增加运行时依赖）。
 *         评审时须核对最终 unpacked 体积，避免为「省上下文」反而先吃掉磁盘。
 */
