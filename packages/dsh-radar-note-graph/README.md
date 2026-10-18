# dsh-radar-note-graph

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> 调用即抛错 —— 这是故意的，避免「看起来能跑」的骨架被误用。

## 集成类型：**全新视图**（⚠ 不是强化式集成，雷达不为它编造叙事）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **全新**（补一个缺的视图） |
| 挂在哪里 | `dsh-zhiyun-page-notes`（「笔记」页）右栏 `NoteRelations` 下方的**折叠区块** |
| 是否新增导航项 | **否** |
| 判据 ③（底层更优） | ❌ **不成立** —— 本仓没有任何图谱渲染器，这是「无 → 有」 |

### 为什么要明确写成「全新」而不是「重复且可强化」

雷达的强化式集成要求三条同时成立，其中 ③ 是「**已有实现**、外部有更优底层」。
本候选的实际情况是：

- `dsh-zhiyun-vault` **已经**算出了 `graph: { nodes, edges }`，
  每个节点带 `inDegree / outDegree / tags`，还能给出 `orphans`（孤立节点）；
- 但 `packages/dsh-zhiyun-page-notes/src/` 里**没有任何代码在画它** ——
  `graph` 这个 RPC 方法没有任何页面消费者，`vault` 的 README 第 3 行写的
  「知识图谱」停留在数据层。

所以这不是「把 A 换成更好的 B」，是「B 一直没有视图」。把它写成强化式集成
会让评审误以为存在一条旧的渲染路径可以对比 —— **不存在**。

### 那它凭什么值得做（而不是又一个玩具）

1. **零新增数据成本**：图已经算好了，全库重算一次 `buildIndex()` 的产物就是它。
   本包不解析 `.md`、不新增存储、不新增 RPC 方法。
2. **`[[双链]]` 的价值只在图里显现**：现有反链列表是**单点**的（当前这篇），
   读不出「谁和谁通过第三篇连上了」。这是「笔记」页与普通 Markdown 编辑器的分界。
3. **孤立节点可行动**：`orphans` 是「还没连起来的想法」，图谱里高亮它，
   是唯一能让人顺手去补一条链接的界面。

### 为什么选 cytoscape 而不是 sigma.js / force-graph / 自己写 SVG

| 方案 | 结论 |
| --- | --- |
| **cytoscape@3.34.4** | ✅ **选它**。`dependencies: {}` 零运行时依赖；图论能力（连通分量、最短路径）**内置**，将来「两篇笔记怎么连上的」不用再引一个库；SVG/Canvas 双渲染器，导出 PDF 不空白。⚠ 修正一处易错认知：**入度/出度不在 cytoscape 里**，`dsh-zhiyun-vault` 已算好并随节点下发（`inDegree`/`outDegree`），本包只负责映射 |
| `sigma`(4.0.3) + `graphology`(0.26.0) | WebGL，几千节点更流畅，但**两条包**（sigma 依赖 `graphology-utils`，graphology 依赖 `events`），且 WebGL 在打印/导出路径上更脆弱 |
| `vasturiano/react-force-graph`（★3325） | 强，但**绑定 3D/VR 叙事**，对「侧栏里一张小图」是过度设计；且依赖 `three` |
| 自写 SVG + 力导向 | 布局收敛、拖拽、缩放、命中测试都要自己写；本仓**没有**这类积分 |

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`cytoscape/cytoscape.js`](https://github.com/cytoscape/cytoscape.js) |
| npm | `cytoscape@3.34.4`（**锁版，无 `^`**） |
| 布局扩展 | [`iVis-at-Bilkent/cytoscape.js-fcose`](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) → `cytoscape-fcose@2.2.0`（依赖 `cose-base@^2`） |
| 许可证 | **MIT** ✅（`cytoscape` 依赖链为 MIT；`cytoscape-fcose` 依赖链为 `cose-base`，MIT） |
| 语言 / stars | JavaScript / ★11239（fcose ★186） |
| 最近 push | 2026-10-15（fcose 2026-04-17） |
| 作者 | Cytoscape Consortium / Bilkent VIS |
| 类型 | **B · 其他 JS 项目**（无 `dsh.bundle.patch`，纯库） |

### 前置条件核实

| 项 | 上游要求 | 本仓现状 | 结论 |
| --- | --- | --- | --- |
| 运行时依赖 | `cytoscape` 为 **空**；`cytoscape-fcose` → `cose-base@^2` | — | ✅ 新增传递依赖仅 1 个 |
| Node | 无 engines 约束 | `^22.19.0 \|\| >=24.0.0` | ✅ |
| React | 不需要（不是 React 组件，`cy.mount()` 即可） | `18.3.1` | ✅ 反而更少约束 |
| 打包 | 浏览器 UMD/ESM 均可 | `esbuild` 0.25.12 | ✅ |
| 明暗主题 | — | 壳的 `--zy-*` 变量 | ⚠ 需在 `style` 里用变量，不得写死色值 |

## 已知风险（评审前必读）

1. **⚠ 挂载形态是两种，成本差很多（见 `src/index.js` TODO 1）**
   **首选**：本包只导出组件 + 纯函数，由 `page-notes` 的右栏直接 import ——
   此时 `cordis.patch.yml` 应**删掉**，本包退化为纯库包，零运行时风险。
   **备选**：作为独立 bundle 行 insert，则需要 `page-notes` 先提供一个「右栏插件位」；
   若没有，那就是**凭空新增挂载点**，不是零成本。评审须先选路。
2. **布局会阻塞主线程**。fcose 在几千节点上是秒级。骨架已定「>800 篇改为
   `preset` + 手动布图」，但**阈值要用真实库量校准**（本仓没有真实笔记库数据）。
3. **右栏默认收起**（page-notes README 明说，实测 250px 会把正文挤坏）。
   因此图谱默认**不会被看到** —— 这与「做了个功能却没人发现」是同一类失败。
   建议：状态栏的「链接 / 标签数」可点，点开右栏并展开图谱区。
4. **打印/导出**：`page-notes` 若走 PDF 导出，canvas 渲染会空白，须显式切 SVG 渲染器。
5. **不要做成第二个反链列表**。折叠区标题只写计数，不再列一遍文字。

## 需要人工裁定

| # | 决议项 | 雷达建议 |
| --- | --- | --- |
| 1 | 「无 → 有」是否算强化（决定本包进 🟢 还是 🔵） | 记为**全新**；若产品决定「笔记页不做图谱」，直接关闭本包 |
| 2 | 纯库包 / 独立 bundle 行（TODO 1） | **纯库包**（删 `cordis.patch.yml`），由 page-notes 自己 import |
| 3 | 节点坐标是否持久化 | **不持久化**（首版）。要持久化须新增存储位，与「笔记库只有 .md」冲突 |
| 4 | 是否跟随当前笔记高亮 | **不跟随**（避免每点一篇就重排）。只在图谱内点击时打开笔记 |
| 5 | 是否引入 `cytoscape-fcose` | 首版**只用内置 `cose`** 即可验证；fcose 在 >500 节点时再考虑，可减少一个传递依赖 |

## 边界

- **只读**：不改 vault 索引、不改笔记正文、不新增 RPC。
- **不改上游源码**；cytoscape 是纯库，没有 patch 点。
- **锁版**：`dependencies` 精确写版本，不用 `^`；版本号在 `src/upstream.js` 里也是单一真源。
- **不新增导航项**。

## 目录

```text
packages/dsh-radar-note-graph/
├── package.json     # 锁版引入 cytoscape@3.34.4 / cytoscape-fcose@2.2.0（无 ^）
├── cordis.patch.yml # - insert: [{ id: radar-note-graph, name: dsh-radar-note-graph }]（若走纯库包则删除）
├── src/index.js     # 占位 + 适配点 TODO（无业务逻辑）
├── src/upstream.js  # 锁版凭据 + 转换函数形状说明（未实现）
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

## 许可与署名

上游 MIT，本骨架**仅锁版引用、不摘取任何源码**，故无 `ATTRIBUTION.md`。
若后续确有代码借鉴（例如照抄 fcose 的参数选择），按 `CONTRIBUTING.md` 3.3 补登记。
