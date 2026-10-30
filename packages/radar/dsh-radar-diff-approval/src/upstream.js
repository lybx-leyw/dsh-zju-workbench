/**
 * 上游封装占位 —— **未评审、不可直接使用**。
 *
 * 本文件只记录「上游长什么样」，不 import 上游、不复制任何上游源码。
 * 真正的引入留给评审通过后的实现：`dsh-diff-approval@0.36.1` 已写在 package.json 的
 * dependencies 里（**锁死版本，不用 `^`**）。
 */

/**
 * 占位：评审通过后改为 `await import('dsh-diff-approval')`。
 */
export async function loadUpstream() {
  throw new Error(
    'dsh-radar-diff-approval/upstream: 未实现（骨架占位，不加载上游）',
  )
}

/**
 * 上游坐标（核实于 2026-10-30，r111 轮）
 *
 * 仓库      https://github.com/9087/dsh-diff-approval
 * npm       dsh-diff-approval
 * 版本      0.36.1（npm dist-tags.latest；2026-10-19 发布；仓库 package.json 同为 0.36.1）
 * 许可证    MIT ✅（GitHub `license.spdx_id = MIT`，npm `license = MIT`，两处一致）
 * 形态      A · 原生 DSH 插件（dsh.bundle.patch + dsh.client.platform=web）
 * 依赖      dependencies：diff ^9 / shiki ^4.4.3 / @shikijs/langs ^4.4.3 /
 *           marked ^18 / dompurify ^3.4.15 / @deepseek-ai/dsh-home-paths ^0.1.0-rc.5
 *           peer：react ^18.2.0、@deepseek-ai/cordis >=4.0.1
 * 体积      tarball unpackedSize ≈ 20.06 MB（shiki 全语言高亮）
 * 规模      ★15 · fork 少量 · 建仓 2026-08-16 · pushed 2026-10-28（活跃）
 *
 * patch 形状（上游 cordis.patch.yml 原文，2 行 insert，id=diff-approval）：
 *   - insert:
 *       - id: diff-approval
 *         name: dsh-diff-approval
 *
 * 能力面（读 npm description 与 README 核实）：
 *   - 待审变更队列：Agent 的每次文件编辑先入队，用户逐条审批；
 *   - 整文件 diff 展示（shiki 语法高亮）；
 *   - 按文件 / 按块 Keep 与 Revert；
 *   - 撤销 / 重做。
 *
 * 评审要点：
 *   - 上游自带 bundle layer → 与本包的 patch **不能同时挂**；
 *   - 体积 20 MB，接入前先确认可接受；
 *   - 本仓的论文写入是否真的经过这条审批通道，决定它是「强化」还是「全新」。
 */
export const UPSTREAM = Object.freeze({
  repo: '9087/dsh-diff-approval',
  npm: 'dsh-diff-approval',
  version: '0.36.1',
  license: 'MIT',
  kind: 'A · 原生 DSH 插件',
  peer: { react: '^18.2.0', cordis: '>=4.0.1' },
})
