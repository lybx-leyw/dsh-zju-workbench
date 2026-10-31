/**
 * 上游封装占位 —— **未评审、不可直接使用**。
 *
 * 本文件只记录「上游长什么样」，不 import 上游、不复制任何上游源码。
 * 真正的引入留给评审通过后的实现：`dsh-conversation-tree@0.1.2` 已写在 package.json 的
 * dependencies 里（**锁死版本，不用 `^`**）。
 */

/**
 * 占位：评审通过后改为 `await import('dsh-conversation-tree')`。
 */
export async function loadUpstream() {
  throw new Error(
    'dsh-radar-conversation-tree/upstream: 未实现（骨架占位，不加载上游）',
  )
}

/**
 * 上游坐标（核实于 2026-10-30，r110 轮）
 *
 * 仓库      https://github.com/chriswang/dsh-conversation-tree
 * npm       dsh-conversation-tree
 * 版本      0.1.2（npm dist-tags.latest；仓库 package.json 已到 0.1.3，但 0.1.3 未发布到 npm）
 * 许可证    MIT ✅（tarball 内 package/LICENSE 实文 = "MIT License / Copyright (c) 2026 chriswang"）
 * 形态      A · 原生 DSH 插件（dsh.bundle.patch + dsh.client.platform=web）
 * 依赖      dependencies = null（零运行时依赖）
 * 产物      lib/ 预构建（index.js / client.js / host-*.js / map-store.js …），含 LICENSE
 * 引擎      engines.dsh = ">=0.2.1-rc.3"
 * 规模      ★0 · fork 0 · 建仓 2026-10-27 · pushed 2026-10-30（在建）
 *
 * patch 形状（上游原文，2 行 insert，id=conversation-tree）：
 *   - insert:
 *       - id: conversation-tree
 *         name: 'dsh-conversation-tree'
 *
 * 能力面（读上游 README + locale/zh.json 核实）：
 *   - 会话列左侧「对话树栏」：工作区 → 主题 → 对话，可折叠、可拖宽（最小 320px）；
 *   - 多「空间」，每空间一棵独立树；面包屑切换；
 *   - 栏内搜索：节点标题/说明 + 已索引会话标题 + 会话正文（仅 user/assistant 文本）；
 *   - 9 个模型工具：map_list_workspaces / map_get_state / map_plan_goal /
 *     map_create_nodes / map_update_nodes / map_move_nodes / map_move_session /
 *     map_attach_sessions / map_delete_nodes；
 *   - Host 落盘 $DSH_HOME/conversation-map/map.json，走 /conversation-map RPC + revision 乐观锁；
 *     Host 不可用时降级为浏览器本地模式。
 *
 * 已知限制（上游自述，全部影响评审结论）：
 *   - 依赖 4 处产品公开 DOM 约定 → 产品改结构会退化为「暂不可用」；
 *   - 左侧带槽位只有一个，靠 html[data-dsh-band-owner] 协商，**两个带插件必冲突**；
 *   - 搜索**不支持模糊、分词与拼音** ← 本仓 search-fuzzy / search-segment / pinyin-match 的接缝；
 *   - 跨工作区移动会话不支持；单写者；界面文案目前只有中文。
 */
export const UPSTREAM = Object.freeze({
  repo: 'chriswang/dsh-conversation-tree',
  npm: 'dsh-conversation-tree',
  version: '0.1.2',
  license: 'MIT',
  kind: 'A · 原生 DSH 插件',
  engines: { dsh: '>=0.2.1-rc.3' },
})
