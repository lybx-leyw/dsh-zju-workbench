/**
 * dsh-radar-commit-semantics —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 一个**纯函数库**（B 类，不插槽、不注册路由、不碰宿主插件系统）：
 * 输入一行或多行提交信息，输出
 *
 *     { type, scope, description, isBreaking, isConventional, references[], authors[] }
 *
 * 上游 `northword/tiny-conventional-commits-parser`（MIT，★2，npm `0.1.0`）
 * 只有 4 个源文件、共约 5.2 KB，`parse.ts` 是一个正则 + 引用抽取，**无传递依赖**。
 *
 * ── 为什么这是「强化式集成」而不是「新功能」──────────────────────────
 *
 * 三条同时成立：
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不注册路由。语义解析的结果只喂给
 *      已有的「插件页 · 发布记录」与「雷达基线告警」两处文本生成，
 *      用户看到的仍是原来那两处文案。
 *   2. **功能仍相似正交** —— 仍是「把提交 / 版本信息写成一句人话」，
 *      只是从「按前缀字符串切一刀」升级为「按规范拆出 type / scope / breaking / 引用」。
 *   3. **底层多调了更优质实现** —— 本仓**零** conventional-commit 解析
 *      （`grep -rniE "conventional|BREAKING CHANGE|breaking "` 命中 0）。
 *
 * ── 不能照抄上游的三处（均为在沙箱里读 `parse.ts` 源码得出的实证）────
 *
 *   P0 · **`ConventionalCommitRegex` 两端都没锚**（无 `^` 也无 `$`），且 `description`
 *        用的是 `.+`（贪婪、不跨行）。实测（`docs/ecosystem-radar/2026-10-29-06.md` §3.2）：
 *        中文正文**不会**误命中（正则要求 `type: ` 前只能是空白，中文前导字符挡掉了）；
 *        但 `Fix: 大写仍命中` 返回 `type:'Fix'` —— **类型大小写未归一**，
 *        下游按 `type === 'feat'` 全等比较时会漏掉一整类提交。本仓必须先 `^...$` 锚定，
 *        再对 `type` 做 `toLowerCase()`。
 *   P0 · **`isBreaking` 认正文而不是 footer**。上游 `BreakingRE = /breaking[ -]changes?:/i`
 *        是**全文 `test`**，所以正文里写「本提交不构成 breaking change:」同样命中 ——
 *        一个**否定句被判成破坏性变更**，直接导致版本号被错误地升 major。
 *        本仓必须把「breaking」的判定限定在 **footer 段**（最后一段、`Token: value` 形态），
 *        并且**否定语境要显式排除**。
 *   P1 · **`References` 去重只按 `value`，不按 `type`**：`(#12)` 先入队成 `pull-request`，
 *        随后 `#12` 的 issue 扫描被 `some(i => i.value === m[1])` 挡掉 ——
 *        结果正确，但**纯属顺序巧合**；一旦上游调整扫描顺序，同一编号会同时是 PR 和 Issue。
 *        本仓输出里 `type` 必须参与去重键。
 *   P1 · **`parseRawCommit` 把 `|` 当字段分隔符**（`commit.split('|')`）。
 *        提交信息里出现 `|`（表格、管道、数学符号）会把正文切碎。
 *        接入时**不要**用上游的行格式，本仓自己从已有的 `git log` 结构化数据
 *        （`%H%x09%s%x09%b%x09%an%x09%ae`）填 `RawGitCommit`，只调用 `parseCommit()`。
 *
 * ── 明确不做 ────────────────────────────────────────────────────────
 *
 *   · 不生成 CHANGELOG 文件，不算 semver 增量（那是 `semantic-release/*` 的事，
 *     本包只负责「语义」这一层）。
 *   · 不读写 git 仓库（不做 `git log` 子进程），输入由调用方给。
 *   · 不写测试（skill 硬边界）。
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js'

/** 插件名。宿主按它做去重与日志前缀。 */
export const name = 'dsh-radar-commit-semantics'

/**
 * 占位 `apply()`：**故意抛错**。
 *
 * 若哪天有人在 profile 里写上 `dsh-radar-commit-semantics`，启动期会立刻失败并指回本文件，
 * 而不是带着一个空实现静默跑起来。评审通过后把这段替换成真正的 `provide`。
 */
export function apply() {
  throw new Error(
    `[${name}] 候选骨架，未实现。锁版 ${UPSTREAM_PACKAGE}@${UPSTREAM_VERSION}，`
    + '本包尚未评审、未接入 profile。见 packages/radar/dsh-radar-commit-semantics/README.md',
  )
}

export { describeCommit, isBreakingCommit } from './upstream.js'
