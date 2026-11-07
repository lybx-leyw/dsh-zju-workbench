# dsh-radar-data-quality —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 于 **2026-11-01 · 18:00 · A 组 sort=updated 轴** 自动生成，
> 仅用于人工评审。
> `src/index.js` 的 `apply()` 只打一行日志；`src/upstream.js` 的 `loadUpstream()` 永远返回
> `{ ok: false, error: 'candidate skeleton: not implemented' }`。
> 本包**没有**被写进 `profiles/zhiyun-bench/package.json`，也不会自动加载。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。评审驳回则整目录删除。

---

## 一句话

**本仓的「引用核对」是一条字符串包含判据，它把真实引用判成假的。**

`packages/dsh-zhiyun-core-quiz/src/points.js:144`：

```js
if (!source || typeof item.quote !== 'string' || item.quote.length < 8
    || !source.snippet.includes(item.quote)) return { error: '外部来源或引用无法核对' };
```

`1,234` vs `1234`、`12.3%` vs `0.123`、`三万` vs `30000` —— 全部被判「无法核对」。
上游 `dsh-data-quality` 的 `verifyCitations()` 用**相对容差**做同一件事，并给出四态结论。

## 集成性质：**强化式集成**（不是「全新」）

| 判据 | 是否成立 | 说明 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 不新增页面 / 导航项。学生看到的仍是学习页那张材料卡、测验时那条质检结论。本包**无 UI** |
| 功能仍相似正交 | ✅ | 仍是「这段数字/引用可不可信」。上游的列类型推断、单位归一、IQR 离群，是同一条质检流程里**本仓空缺的那一段** |
| 底层多调了更优质实现 | ✅ | 字符串包含 → 定位符行走 + 数值相对容差 + 四态结论 |

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/PerryLink/dsh-data-quality> |
| 版本（锁版） | `dsh-data-quality@0.3.24`（npm `latest`，2026-10-24 发布） |
| 许可证 | **Apache-2.0** ✅（GitHub metadata / `LICENSE` 首行 / npm `license` 三源一致） |
| 作者 | PerryLink |
| 星级 / 活跃度 | ★54 · push 2026-11-01 · 98 个发布版本 · CI + OpenSSF Scorecard |
| npm unpacked | 927,706 B（≈0.88 MB）；唯一运行时依赖 `zod@4.4.3` |
| 类型 | **A · 原生 DSH 宿主插件**（`dsh.bundle.patch` → `./cordis.patch.yml`；`exports` 只有 `.`，**无前端半边**） |
| 与现有功能的关系 | **重复且可强化** —— 见下 |
| 集成方式 | A 类**锁版挂载 + 外围兼容层**（效法 `dsh-zhiyun-paper`、`dsh-zhiyun-page-paper`） |

## 强化了哪个现有功能

| 能力 | 本仓现状 | 上游 |
| --- | --- | --- |
| 引用核对 | `points.js:144` 字符串 `includes()`，零容差、单位敏感 | `verifyCitations()`：定位符行走 + 相对容差 `\|a-b\| <= tol*max(\|a\|,\|b\|)` + 四态 |
| 单位归一 | 无（`万/亿` 只能人工） | `normalize-unit` 规则 |
| 表格梳理 | 无 | 列类型 / 缺失率 / 唯一值 / 分位 / IQR 离群 / 混合类型 / 重复行 |
| 谁来算 | 模型或字符串比较 | **harness 进程内纯 TS，模型从不心算** |
| 网络 | — | **无网络、无凭据、无外部进程**（上游 README 明示） |

## 最大风险（评审请先看这条）

**上游只认 `.csv / .tsv / .json / .jsonl`**（`allowedExtensions` 默认值）。

本仓课程材料大量是 `.md` / `.html` / `.docx` / PDF 抽取文本 —— **这些它读不了**。
也就是说：**如果课程材料的引用只存在于 `.md` 笔记里，这个方案对绝大多数引用无效。**

评审须在两条里选一条：

- **A**（推荐）：接受「只对表格类材料生效」。本包只解决「课件 PDF 里抽出来的表格 / 实验数据 / 问卷数据」这一类，其余退回到现状的字符串判据。骨架按这条出具。
- **B**：要求上游扩展白名单（或其 `verifyCitations` 支持任意 JSON 文档 —— README 说它**可以**行走任意 JSON，但工具层被扩展名挡住）。若走这条，本骨架方案不成立，需改为「借容差公式自实现」。

## 挂载形状

```text
- insert:
    - id: radar-data-quality      # 本仓 id，非上游 id
      name: dsh-radar-data-quality
```

`src/index.js` 在本包 ctx 上 `import()` 上游并调用其 `apply()`。**上游源码一行不改。**

## 目录

```text
packages/radar/dsh-radar-data-quality/
├── package.json     # dependencies 锁 dsh-data-quality@0.3.24（写死，不用 ^）
├── cordis.patch.yml # 本包 id 插入，不带 config
├── src/index.js     # 占位 + TODO（7 条）
├── src/upstream.js  # 锁版凭据 + peer 区间断言
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

> 无 `ATTRIBUTION.md`：本骨架**未摘取上游任何代码**，只登记其公开接缝的调用形状。

## 接入前必须先做的事

1. 回答 `src/index.js` 的 7 条 TODO（其中 TODO 2「工具是否污染全局 registry」与
   TODO 4「材料扩展名」可能直接否决方案）。
2. 在评审环境实测：粘贴一段带 `1,234` 的表格引用，确认 `verifyCitations` 给
   `verified` 而不是 `mismatch`。
3. 实测「笔记 / 论文访话里模型是否会误调 `data_clean`」。
4. 通过后才可写实现、补测试、接入 profile。
