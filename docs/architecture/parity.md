# 课堂产物一致性闸门（parity）

本文件说明 `scripts/classroom-golden-parity.mjs` 的判据、容差与退出码，是 `classroom-port.md`
§1 三条判据里 **第 1 条（能力等价）与第 2 条（观感等价，文本部分）** 的验收工具说明书。

第 2 条的像素部分（白板 / 公式 / 图表截图 diff）不在本工具范围，见 §8。

## 1. 用它做什么

```bash
node scripts/classroom-golden-parity.mjs --a <dirA> --b <dirB> [--json]
```

`--a` / `--b` 是两份**课堂产物目录** —— 通常是"上游 `ref/OpenMAIC` 跑出来的"和"本仓
`ctx.zhiyunClassroomExport` 跑出来的"，也可以是同一个目录自比（冒烟）。

- `--json`：输出完整报告（机器读）；默认输出四行人类可读摘要。
- `--help`：用法。
- 退出码：`0` = `identical` / `equivalent`；`1` = `divergent` / `broken`；`2` = 用法错误。

CI 里直接当闸门用，不需要解析输出。

## 2. 产物目录契约

| 文件 | 必需 | 用途 |
|---|---|---|
| `classroom.html` | 二者之一 | `html()` 的返回值。目录里没有同名文件时，取目录下排序第一个 `*.html` |
| `classroom.pptx` | 二者之一 | `pptx()` 的返回值。同上，退到第一个 `*.pptx` |
| `classroom.json` | 可选 | 课堂文档 `{ stage, scenes }`。**仅当** html 缺失或 html 里没有清单时作为场景来源 |

两个目录各自独立解析，不要求同名同构。两边都缺某类产物时，对应维度记 `skipped`；
**只有一边**缺，记 `divergent`（`kind: missing-artifact`）。

## 3. 维度一：场景序列

来源优先 `classroom.html` 里 `<script type="application/json" id="openmaic-classroom">`
的清单（这是播放器实际读的那份数据，也就是用户真正看到的顺序），其次 `classroom.json`。

比的是 `type` 数组（`slide` / `quiz` / `interactive` / `pbl`），三项都管：**类型、顺序、数量**。

| 情况 | 判级 |
|---|---|
| 数组逐项相等 | `identical` |
| 长度不同 / 同位置类型不同 | 先看多重集：相同 → `equivalent`（只是顺序不同），否则 `divergent` |

差异项带 `index`（0 起），CLI 显示成"第 N 个场景"，例如：

```
scenes  divergent  slide→interactive→quiz→pbl  ≠  slide→interactive→pbl  首个差异 @场景3: quiz/pbl
```

## 4. 维度二：DOM 文本

### 4.1 取什么

从 html 产物里取**清单 JSON**，逐场景抽"画面上的字"：

| 场景 | 抽取范围 |
|---|---|
| 场景公共 | `title` |
| `slide` | `canvas.elements`：`text`（HTML 富文本去标签）、`latex` 源码、`chart` 的 `labels` / `legends`、`table` 单元格、`group` 递归 |
| `quiz` | `questions[].question`、`options[].label` |
| `interactive` | `content.html`（先删 `<script>` / `<style>` / `<template>`，再去标签） |
| `pbl` | 项目 `title` / `description` / `learningObjective`、`scenario.*`、人物 `name` / `persona`、`milestones[].title|description`、`microtasks[].title|description`、`hints` |
| 其他类型 | 兜底：按对象顺序收字符串，跳过 `id` / `src` / `color` / `path` / 时间戳等机器字段 |

**故意不进比对的**：正确答案 `answer`、解析 `analysis`、讲稿 `actions[].text`、样式与几何。
理由：前两者是答题后才出现（不属于"同一场景渲染出的可见文本"），讲稿不进画面，
几何/颜色由截图 diff 管。把这些塞进来只会让"移植必然的措辞差"淹没真回归。

### 4.2 归一化（容差）

1. 解 HTML 实体（`&amp;` `&#39;` 与 `&#x…`）；
2. 去零宽字符：`U+200B` `U+200C` `U+200D` `U+2060` `U+FEFF`；
3. 压空白：所有空白序列压成一个空格、去首尾（`loose` 口径下连空格一起去掉）；
4. 块级标签（`p` `li` `div` `h1-6` `br` `tr` …）断行，丢弃空行；
5. 相邻重复行只留一份（标题同时出现在 `scene.title` 与正文时不算差异）。

### 4.3 配对与判级

场景**按「类型 + 该类型内的出现序号」配对**，不是按下标 —— 这样"整体换序"能配对上，
不会被报成一串假 `divergent`。

| 情况 | 判级 |
|---|---|
| 逐行（已压空白）相等 | `identical` |
| 行不等，但**去掉全部空白后整段相等**（换行/段落边界不同） | `equivalent` |
| 行不等，但整行多重集相等（行内顺序不同） | `equivalent` |
| 一侧缺这一场，或字词/行数有实质差异 | `divergent` |

差异项给 `firstDifference`：`line`（1 起）、两侧该行原文（截断 160 字）、`contextA` /
`contextB`（该行前后各一行）。CLI 摘要：

```
text  divergent  @场景1(slide) 第4行 A=Outputs: glucose and oxygen. B=Outputs: glucose and water.
```

**同一行内的连续空格差异判 `identical`**：压空白本来就把它们抹平了，这是有意的容差
（排版层面的空白由截图 diff 兜）。

## 5. 维度三：PPTX 结构

`node:zlib` 手写 zip 读端（中央目录 + 本地头，`stored(0)` 与 `deflate(8)` 都吃，
长度不符即报错），不引任何依赖。要求 `ppt/presentation.xml` 存在，否则 `broken`。

比三件事：

1. **页数**：`ppt/slides/slideN.xml` 的个数（按 N 排序）；
2. **每页文本节点集合**：`<a:t>` 抽文本 → 归一化 → 去重排序后比**集合**（同页重复文本不额外扣分）；
3. **公式数**：每页 `<m:oMath>` 元素个数（`<m:oMathPara>` 只是容器，不重复计）。

| 情况 | 判级 |
|---|---|
| 页数相同，且每页集合 + 公式数相等 | `identical` |
| 每页对得上但**页的顺序**整体不同 | `equivalent` |
| 某页文本只是空白/换行差（`§4.2` 的 loose 口径相等）且公式数相同 | `equivalent` |
| 页数不同，或缺文本、公式数变化 | `divergent` |
| zip 解不开 / 缺 `presentation.xml` / 没有幻灯片 | `broken` |

注意：`pptx()` 会为 `interactive` / `quiz` / `pbl` 生成**占位页**（"打开链接 / 扫码"），
所以页数 = 幻灯片场景数 + 占位场景数。这是上游行为，比对时如实计入。

## 6. 总体判级

取所有非 `skipped` 维度的最差一级：`broken > divergent > equivalent > identical`。
任一维度 `broken`（解不开）→ 整体 `broken`，退出码 1。

## 7. golden 语料

`fixtures/classroom-golden/`：

| 文件 | 角色 |
|---|---|
| `classroom.json` | **输入**：一个 4 场景课堂（slide / interactive / quiz / pbl 各一，故意乱序存放） |
| `classroom.html` | 产物：`html()` 结果 |
| `classroom.pptx` | 产物：`pptx()` 结果 |
| `generate.mjs` | 重生成上面两个产物（调本仓导出包） |

语料里保留了判据 2 的几个硬用例：标题里的 `<Light> & "Life"`、题干里的
`</script><!-- not markup -->`、幻灯片富文本 `ul>li>p`、`latex` 公式、柱状图、
互动页内联脚本。

重新生成：

```bash
node fixtures/classroom-golden/generate.mjs
```

**只有在确认导出层改动是预期的时候才重跑**，并在 PR 里说明产物为什么变。
（本仓无 git 时，比对文件大小与 mtime。）

## 8. 已知"移植必然、判为可接受"的差异

以下是本工具会照常报出、但按判据 **不该阻断合入** 的差异，评审时人工确认：

1. **场景顺序**：文档里的 `scenes` 可能是乱序存库的，导出层按 `order` 重排。序列维度
   判 `equivalent` 即通过，不要求字节级同序。
2. **换行 / 段落边界**：上游富文本在浏览器里由 CSS 决定折行，导出时按块级标签断行，
   同一段话可能多/少一个行边界 → `equivalent`。
3. **PPTX 占位页文案**：占位页的提示语走 i18n 表（`lang` 不同即不同），且本仓不带
   `uqr` 时二维码恒不画（`placeholders.js` 头注）。文案一致的语料下仍是 `identical`；
   跨语言对照时把 `lang` 对齐即可。
4. **`[Formula]` 之类的降级标记**：拿不到渲染字体时上游也会输出同类替代文本，
   两边都走同一条降级路径则无差异；只有单边降级才会 `divergent` —— 那是真回归。
5. **`exportedAt` / `appVersion` / 媒体 `data:` 字节**：不在三个维度的比对范围内
   （时间戳与版本号天然不同，图片字节由 hash 另测）。

**不算可接受的**：缺场景、少一页、少一个字、公式数变化、zip 打不开。这四类一律退出 1。

## 9. 局限

- 文本维度读的是 html 内嵌清单（播放器实际消费的数据），**不执行播放器脚本**：
  运行时才产生的内容（互动页脚本动态写入的字）不在比对范围。互动页整体按
  `content.html` 的静态文本比。
- 像素级观感（白板笔迹、图表渲染、公式排版）不在本工具内，另用截图 diff。
- 本工具只比两份产物，不判断"哪边对"。哪边是基准由调用方决定（`--a` 通常是上游）。
- 原有的 Dart 模型字段对照已移到 `scripts/classroom-model-parity.mjs`（`npm run
  classroom:parity` 现在指向本工具，模型对照请直接跑那个文件），两者管的事不重叠：
  一个比字段映射，一个比产物。
