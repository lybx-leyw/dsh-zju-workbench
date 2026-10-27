// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 cytoscape（图论 / 网络可视化库，MIT，零运行时依赖）封装成
//       「笔记」页右栏的一个**折叠区** —— 把 `dsh-zhiyun-core-vault` 早就算好的
//       `graph: { nodes, edges }` 真正画出来。
//
// 上游：https://github.com/cytoscape/cytoscape.js
//       npm: cytoscape@3.34.4（锁版，不用 ^；见 ./upstream.js）
//       布局扩展：cytoscape-fcose@2.2.0（MIT，依赖 cose-base@^2）
//       许可证：MIT ✅（宽松白名单）
//
// 性质：B 类（其他 JS 项目）—— 能力提取 + 封装；上游没有 dsh.bundle.patch，
//       故本包不引入任何上游 DSH 包，`dependencies` 只有纯 JS 库。
//
// # 集成判定：⚠ 严格说不是「强化式集成」，是「补一个缺的视图」（定性需人工拍）
//
// 三条判据逐条对照：
//   ① 仍是同一个面板 —— ✅ 不新增页面、不新增导航项。图谱是「笔记」页右栏
//      `NoteRelations` 下方的一个**默认折叠**区块（右栏本就默认收起，见
//      packages/dsh-zhiyun-page-notes/README.md）。
//   ② 功能仍相似正交 —— ✅ 同一批笔记、同一份链接数据，只是从「一篇的反链列表」
//      （局部、文字）换成「全库的链接网」（全局、图形）。不新增编辑、不新增存储、
//      不新增检索入口。
//   ③ 底层多调了更优质实现 —— ⚠ **这一条不成立**：本仓**没有**任何图谱渲染器，
//      所以不存在「已有实现、换成更好的」。现有能力是「算得出图、画不出来」。
//
//   因此本包按「**全新视图**」登记，而不是「重复且可强化」。
//   雷达不为它编造强化叙事 —— 这一点请评审优先确认（见 README「需人工裁定」#1）。
//
// # 为什么不是「重复且无增益」
//
//   有人会说「右侧反链列表已经是图谱了」。不是：
//   - 反链列表是**单点**的（当前这一篇），图谱是**全库**的；
//   - 反链列表读不出「谁和谁通过第三篇连上了」，而这恰恰是 `[[双链]]` 的意义；
//   - `dsh-zhiyun-core-vault` 已经为此维护了 `inDegree / outDegree / orphans / tags`，
//     这些字段**目前没有任何消费者**（vault README 第 3 行明确写了「知识图谱」，
//     但页面里没有任何渲染）。本包消费它们。
//
// # 边界（评审前请确认这四条）
//
//   1. **只读**：不改 vault 索引、不改笔记正文。点节点 = 打开那篇笔记（复用现有 `onOpen`）。
//   2. **不写库**：节点坐标只放在内存（关闭即丢），**不落盘**。
//      —— 曾考虑照 Obsidian 的 `persistent-graph` 存坐标，但那需要一个新存储位置，
//      与「笔记库只有 .md 文件」的模型冲突。首版不做。
//   3. **规模闸门**：> N 篇（建议 800）时默认不自动布局，改为「点击后才渲染」，
//      否则打开笔记页会卡住（fcose 在几千节点上是秒级）。
//   4. **不做 3D / 不做时间轴 / 不做标签图**：那些是 `obsidian-extended-graph` 的领域，
//      属于「再造一个视图」，本节目标只有「把已有数据画出来」。

import { LOCK, UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'dsh-radar-note-graph';

/** 兼容旧名（同一值）。 */
export const NAME = name;

// 上游常量是单一真源（版本号改动只改 `./upstream.js` 的 LOCK + package.json）。
export const UPSTREAM = Object.freeze({
  pkg: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  layoutPkg: 'cytoscape-fcose',
  layoutVersion: LOCK['cytoscape-fcose'],
});

/**
 * 本包的宿主半边（cordis 插件入口）。
 *
 * ⚠ 占位：**不实现任何业务逻辑**，调用即抛错 —— 防止「看起来能跑」的骨架被误用。
 * 真正的接线点在 TODO 1~5，评审通过后才写。
 */
export function apply(ctx) {
  throw new Error(
    '[dsh-radar-note-graph] 候选骨架，未评审、未接入 profile、不可直接使用。' +
      '接线点见 src/index.js 的 TODO。',
  );
}

// TODO 1 · 声明本包对「笔记」页的贡献方式
//   - 首选：**不新增 bundle 行**，而是让 dsh-zhiyun-page-notes 的右栏 import 本包导出的
//     GraphSection 组件（即本包只提供组件与纯函数，不自己 apply 一个 plugin）。
//     若最终走这条路，本包的 cordis.patch.yml 应**删除**，改为纯库包。
//   - 备选（当前骨架的形态）：本包作为独立 bundle 行 insert，通过 ctx 暴露一个
//     「右栏插件位」给 page-notes。⚠ 这要求 page-notes 先有插件位，
//     没有的话就是**凭空新增一个挂载点** —— 评审应视作额外成本，不是零成本。
//
// TODO 2 · 数据读取（**不要**自己重新解析 .md）
//   - 一律走 vault 的既有 RPC：`vault.invoke('graph')` → `{ nodes, edges }`。
//   - 节点形状（已核，packages/dsh-zhiyun-core-vault/src/index/vault-index.js）：
//     `{ id: 相对路径(不含 .md), title, inDegree, outDegree, tags }`；边 `{ from, to }`。
//   - **不要**在这里做「未解析链接」推断：vault 已分 `missing` / `ambiguous`，
//     图谱只画已解析的边；未解析的另做一行文字（见 TODO 4）。
//
// TODO 3 · 渲染与性能
//   - cytoscape 实例**懒创建**：右栏展开时才元素实例化，收起时 `cy.destroy()`。
//     （右栏默认收起 → 绝大多数会话根本不会创建实例。）
//   - 布局用 fcose；节点数 > 800 时改为 `preset` + 「手动布图」按钮。
//   - 样式只用壳的 `--zy-*` 变量：节点底色、边色、选中色、禁用色。
//     ⚠ 不要在 JS 里写死颜色 —— 明暗两套要自动跟随（对齐 page-notes 的配色约定）。
//   - 高亮语义：hover 一个节点时，淡出其 1 跳以外的一切（Obsidian 的默认行为）。
//   - 布局是**同步计算**的，大图上会阻塞主线程；若实测超过 100ms，
//     改成 `requestIdleCallback` 后再跑，或直接降到 `preset`。
//
// TODO 4 · 与既有「反链列表」的分工（防止同一件事出现两遍）
//   - 折叠区标题写「链接图 · N 篇 / M 条」，**不做**第二份反链文字列表。
//   - 未解析链接只用一行文字提示条数，点击跳到 vault 已有的未解析处理入口。
//   - 孤立节点（`orphans`）作为图谱里的一个开关（高亮），不单独开列表。
//
// TODO 5 · 边界与降级
//   - vault RPC 失败 / 空库：渲染一句「还没有链接」的占位，**不要**渲染空画布。
//   - 单篇笔记打开时，图谱默认**不**跟随切换（避免每点一篇就重排一次）。
//     只有用户在图谱里点节点才 `onOpen(path)`。
//   - 打印 / 导出 PDF 场景：图谱必须是 SVG 可保存的形态（cytoscape 的 `cy.png()` 亦可），
//     不得使用 <canvas> 独占渲染 —— 否则「导出」这一列会空白。
