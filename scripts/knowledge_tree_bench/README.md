# knowledge_tree_bench —— 知识树基准台

把「知识树 / 讲义」这条链上**所有壳的功能函数**桥过来，供基准用例直接调。

组织形式照 `scripts/source_bridge/`：一个域一个文件，共享 `_base.mjs` 的装配与工具，
入口统一输出 `@@BENCH@@{json}` 一行一条。

## 用法

```bash
node scripts/knowledge_tree_bench/index.mjs --what tree
node scripts/knowledge_tree_bench/index.mjs --what tree,tokenize,shell --json
node scripts/knowledge_tree_bench/index.mjs --what parser        # 需要模型桩，默认不回包
```

`--what` 可选（默认 `tree,tokenize,shell`）：

| 域 | 桥的是什么 | 要不要装配 |
|---|---|---|
| `tree` | 建树/重构纯函数：筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚 → 聚合 | 否 |
| `pipeline` | 共享队列 + worker 池（vision‖mix 的调度器） | 否 |
| `tokenize` | 斩杀线的 token 估算 | 否 |
| `shell` | 版式与路由契约：`NAV` / `FULL_BLEED_PAGES` / 页面画像 / 侧栏 | 否 |
| `lecture` | 讲义两级加工 + 建树 + 文本 codec（纯函数面） | 否 |
| `parser` | **真解析器服务**（跑完整 `parse()` 链路） | 是，需要模型桩 |
| `surface` | 各域服务**暴露了哪些功能函数**（契约快照） | 是 |

## 为什么是桥，不是直接 import 内部类

与 `source_bridge` 同一条理由：直接 `new LectureParser(...)` 验证的**不是产品** ——
它绕过了 `apply()` 的装配（服务注入、配置归一、路由注册）。基准台的全部价值
就是**它测的是真东西**，所以一律经 `apply()` 拿包自己 `provide` 的服务。

**但纯函数例外**：`sieveBlocks` / `mergeLeaf` / `NAV` / `pageProfile` 这些
本来就不经过装配（不碰 ctx、不碰 DOM）。基准要度量"斩杀线取多少、长尾切分对不对、
这棵树该落哪一页"，就直接调它们 —— 而在基准里重写一份页面规则或建树逻辑，
结局是半年后两边不一致。

## 模型永远不真调

`parser` / `lecture` 需要模型，但基准给的是**可编程的桩**：

```js
import { mountParser } from './parser.mjs';

const { parse, dispose } = await mountParser({
  dataDir,
  respond: ({ stage }) => {
    if (stage === 'faithful') return '## 页面文字\n…\n## 页面画面\n…\n## 术语\n…';
    if (stage === 'mix')      return '## 逐块标注\n块 1-1\n1. 正文：…';
    if (stage === 'tags')     return JSON.stringify({ tags: [{ index: 1, role: '主线', facets: ['概念'], summary: '…' }] });
    if (stage === 'outline')  return JSON.stringify({ spine: '…', outline: [] });
    return '';
  },
});
```

**默认桩什么都不回（`NOT_CONFIGURED`）** —— 不给"看起来能跑"的默认回包，
否则基准会在没有真正验证的情况下通过。

⚠️ 两种 llm 形状别混：
- `mountParser` 给的是**宿主形状**（`prepareCall` / `resolveModelInfo` / `stream`），
  因为解析器内部还有一层产品自己的 `HarnessLlm` 适配器要走；
- `mountLecture` 给的是**窄接口**（`{ call({stage,route,constant,variable,signal}) }`），
  因为它从 `ctx.zhiyunParser.llm` 借 —— 那个 llm 已经被适配过了。

## 交互式基准（推荐入口）

```bash
node scripts/knowledge_tree_bench/bench.mjs
```

### 两步走：跑，然后看

**① 评测只跑、不演。** 填一个 API Key，点「开始评测」。

跑的时候你看到的是**真实进展**：顶栏会从"识别中…"走到"识别 8/8""标记 2/2"，
日志逐页滚动（每页读了多少字、哪页失败）。进度条与事件计数都在动。

跑完的结论**分三档**，不再一律画绿：

| 顶栏 | 含义 |
|---|---|
| 完成 · 12.3s | 真的全好了 |
| **跑完但有缺陷** | 跑完了，但润色失败 / 解析 partial / 有页识别失败 |
| 失败 | 没跑通 |

**② 点「逐步调适」进演示页。** 动画是**事后**的调试工具，默认**不自动播**。

### 演示页能回答四个问题

| 问题 | 在哪看 |
|---|---|
| **这一步到底做了什么？** | 右侧「本阶段产物」+ 事件列表（每条都有人话标签） |
| **内容有没有丢？** | 右侧「架构验收」：8 条不变量逐条判定 |
| **它符合我的设计吗？** | 同一面板的「设计图覆盖」：图里每步是 有 / 无 / 推断 |
| **这一节写了什么？** | 点树节点或讲义列表的 ▸，正文全文可读 |

### 验收面板：8 条不变量

这是整个基准台最重要的部分。它检查的不是"做了多少活"，而是**对不对**：

| 不变量 | 它在查什么 |
|---|---|
| 主线覆盖 | 每个主线块都要有归属（内容不能凭空消失） |
| 块不重复 | 同一片段不能进两个知识点（重复收录） |
| 依附有宿主 | 例题/案例必须挂在宿主内容上 |
| 斩杀线有效 | 知识点不能远超斩杀线（切分失效） |
| 同名消除 | 跨不同内容的同名标题必须被审查合并 |
| 讲义沿用树 | 讲义节点必须能追到来源块（不是另建一棵） |
| 内容留存 | 讲义不能大面积空缺 |
| 逐页处理 | 每页都要有 mix 结果或明确失败 |

**三种结果**：`通过` / `违反`（附证据）/ `无法判定`。
`无法判定` 不算通过 —— 那正是"看起来没问题"的伪装。

### 证据可信度是标注出来的

- **实时 vs 补发**：只有 vision/mix 是真正实时发出的（那是唯一的并发证据）；
  标记/建树/讲义是跑完补发的，事件列表里带「事后」徽标。
  读数区显示 `实时 / 补发` 的条数比。
- **队列深度**：产品上报的真实队列长度优先，标「实测」；没有才退回推算，标「估算」。
- **数据范围**：常驻显示 `P7–P78 / 共 81 页`、`1:40 – 11:40`、`整节：否（从中段开始）`。
  不再用"整节 / N 页"糊过去。
- **日志完整性**：有坏行、写盘失败、没有结束记录，都会在页面顶部红条里说清楚。

### 按问题导航

不用逐条翻。四个筛选按钮 + 搜索框：

| 按钮 | 找什么 |
|---|---|
| 失败 | 识别/混合失败、润色失败 |
| 超线 | 超过斩杀线的块与叶 |
| 无来源 | 讲义里没有来源块的节 |
| 补发 | 事后补发的事件（时间戳不可信） |

搜索框搜的是**屏幕上显示的文字**（页号、块号、标题、"识别"），不是内部英文标识。

## 为什么日志是唯一真相

```
run.mjs ──写──▶ .jsonl 日志 ──读──▶ fold() ──▶ 状态
                                      │
                                      ├─▶ 动画（demo/player.mjs）
                                      ├─▶ 验收（shared/audit.mjs）
                                      └─▶ 探针（demo/render.mjs）
```

`fold()` 是**纯函数**：给定日志和 `seq`，算出那一刻的完整状态。
往回拖就是重算一帧，不需要"撤销"，任意跳转都不会漂移。

`shared/log-core.mjs` 是**浏览器与 Node 共用的同一份代码**（无 node 依赖）。
前端不自己再实现一遍 `fold` —— 那正是"两边数字对不上"的来源。

## 一条事件必须自足

判据：只看日志、不看现场，能不能画出那一刻的画面？

```jsonl
{"v":1,"seq":42,"kind":"event","act":"mark","subject":17,
 "data":{"page":7,"role":"主线","facets":["概念"],"summary":"…","chars":250,
         "blockIds":["17#0","17#1"],"deferred":true},
 "t":1834}
```

| 字段 | 含义 |
|---|---|
| `act` | 动作（vision / mix / mark / sieve / stash / merge / regroup / chapter / lecture / polish） |
| `subject` | 对象（页号 / 块号 / 叶 id） |
| `data` | 这次动作产出的**全部**内容 —— 包括转录正文、原字幕对照、讲义全文 |
| `t` | 相对开始的毫秒 |
| `deferred` | true = 事后补发（内容真实，时间戳不是操作时刻） |

**八个阶段**（基准自己的划分，与设计图有对应表）：

```
01 识别（vision+mix）  02 标记  03 筛支线  04 挂账
05 审查合并            06 重构  07 习坎    08 终稿
```

## 文件分工

```
bench.mjs              入口：HTTP 服务 + 拼页面 + 转发事件流
run.mjs                执行器：跑一次解析，写日志
log.mjs                日志的读写（Node）
shared/log-core.mjs    日志契约 + fold + 阶段产物（**浏览器也用这份**）
shared/audit.mjs       架构验收：8 条不变量 + 设计图覆盖
events.mjs             把产品产物翻译成事件（含来源追踪）
defaults.mjs           供应商默认值（只填 Key 就能跑）
ui/bench.html|.css|.js 评测页（只跑不演）+ 历史运行对比
ui/demo/demo.html      演示页外壳
ui/demo/app.mjs        演示页：逐帧推进、探针、筛选、导轨
ui/demo/player.mjs     播放器（纯逻辑，可单测）
ui/demo/render.mjs     SVG 渲染（只读状态，不改）
ui/demo/audit-view.mjs 验收面板渲染
```

## 启动即清缓存

默认清空 `data/.` 开头的**缓存**目录（`.run` / `.run-lecture` …），
但**保留 `.logs`** —— 那是评测产物，演示页与历史列表要读它。

要保留缓存加 `--keep-cache`。

## data/：真实课程的原始材料

`data/<course>-<section>/` 下是**智云课堂的原始材料**，由 `fetch-raw.mjs` 从源头拉取：

| 文件 | 是什么 |
|---|---|
| `0001-<hash>.jpg` … | 课件原图（1280×720，老师的 PPT 本体） |
| `subtitles.json` | 逐句字幕（原始时间轴 + 文本） |
| `pages.json` | 页码 ↔ 文件 ↔ 时间锚点（`createdSec`） |

**不是 vision 转述稿。** 这一点很关键：转述稿是"模型对原稿的解读"，拿它当基准输入，
测的是"复现上一次模型的解读"，而不是"这条链在原始材料上的表现"。更麻烦的是，
已有产物里连图片引用都没留（`pages[]` 只有 `transcription` 与 `failure`），
所以想要原稿只能回源头重下。

### 拉取

```bash
node scripts/knowledge_tree_bench/fetch-raw.mjs                      # 拉 .runtime 里记录过的全部节
node scripts/knowledge_tree_bench/fetch-raw.mjs --course 87882 --section 1973145
```

凭据默认读宿主 profile 里已登录的课堂账号，也可用 `BENCH_ZJU_USER` / `BENCH_ZJU_PASS`。

**`data/` 不入库**（`.gitignore` 里忽略）：真课内容 + 33 MB 二进制。换机器后重拉一次即可。

## 测评

```bash
node scripts/knowledge_tree_bench/measure.mjs              # 人读
node scripts/knowledge_tree_bench/measure.mjs --json       # 机器读
node scripts/knowledge_tree_bench/measure.mjs --split 600,900,1200,1800,2400
```

**结构层不需要模型**：从字幕 + 页序按时间锚点聚成块，走
筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚，度量树形与 token 分布。
这一层完全可复现，是**参数调优的依据**（斩杀线扫描就在这里）。

⚠️ `grain: 'page'`：块边界是**页**，不是产品 mix 阶段的语义块。它度量的是
"页级材料上建树会怎样"这个下界；真正的块级形状要靠跑一次完整解析（要模型）。

### 当前基线（5 节真课 / 375 页 / 8440 句）

| 指标 | 值 |
|---|---|
| 知识点合计 | 202 |
| token 合计 | 186k |
| 每知识点 token | 816 – 1168（默认斩杀线 1200） |
| 超线知识点 | 5（均为切分取整误差，1202–1222） |
| 叶树最深 | 1 层 |

### 斩杀线扫描

| splitLine | 知识点 | 叶树 | 超线 |
|---|---|---|---|
| 600 | 422 | 80 | 21 |
| 900 | 274 | 46 | 0 |
| 1200 | 202 | 28 | 5 |
| 1800 | 128 | 14 | 0 |
| 2400 | 96 | 4 | 0 |

## 底层：直接用 runner

```bash
echo '{"baseUrl":"…","apiKey":"…","sectionKey":"87882-1973145","maxPages":8}' \
  | node scripts/knowledge_tree_bench/run.mjs
```

它往 stdout 打 `@@EV@@{json}` 事件流，供上层流式读取：

| kind | 是什么 |
|---|---|
| `start` | 选中的页段、字幕数、参数 |
| `progress` | 阶段进度（faithful / mix / tags / outline / rebuild / lecture） |
| `parsed` | 解析汇总：块数、主线/支线、树统计、流水线统计、大黑板、失败与告警 |
| `blocks` | 块清单（编号、页码、role、facets、概述） |
| `tree` | 重构后的知识点叶（token、合并段数、页码） |
| `treeBuilt` | 从 PPT 原文建出的知识树（章节 / 知识点） |
| `lecture` | 习坎填充后的讲义结构 |
| `polish` | 全文润色结果（改动清单 / 覆盖 / 全文） |
| `error` | 有名字的失败（`code` + `stage`） |

## 自检

`.verify-scratch/verify-bench.mjs` 是"桥完了"的验收标准：不是"能 import"，
而是**能真的用产品那条路跑出一棵对得上的树**（24 项，全离线）。
