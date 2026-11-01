# dsh-radar-job-hunting —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` **只有占位与 TODO**，
> 所有导出一律抛错。**请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）—— 判 **🟢**

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是「**规划**」页既有条目行（`dsh-zhiyun-page-planning`）。给求职加**一栏**，不新建页、不注册 slot、不注册工具 |
| ② 功能相似且正交 | ✅ | 现有回答「我明天要做什么」（日程 + 插空任务）；新增回答「我的简历对这份 JD 差在哪」。同一个人、同一份档案、同一个「去向」目标 |
| ③ 底层多调了更优质实现 | ✅ | 三条**全部沙箱实跑验证**，见下 |

**本仓的缺口（本轮 `grep` 实测）**

```text
grep -rl "保研\|推免"     packages/*/src  → 0
grep -rl "实习\|招聘\|简历" packages/*/src  → 0
grep -rn  "mammoth|docx|pdf-parse" packages/*/package.json → 0（只有 pdfjs-dist，且只用于「看」PDF）
```

12 个页面、59 个主包，**「这个人要去哪」一格都没有**。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [GOOGUO2333/dsh-job-hunting](https://github.com/GOOGUO2333/dsh-job-hunting) |
| 版本 | **`1.2.2`**（包名 `dsh-plugin-job-hunting`） |
| 规模 | ★0 · 76 KB · JavaScript · **零第三方依赖** · 建仓 = push **2026-10-30** |
| 许可证 | **MIT** ✅（`LICENSE` 正文已读，`package.json.license = "MIT"` 同口径） |
| 形态 | **A 类 · 原生 DSH 插件包**：`package.json` 有 `dsh.bundle.patch` → `./cordis.patch.yml` |
| npm | **无发布**（`registry.npmjs.org/dsh-plugin-job-hunting` → 空）→ 只能按 **git tag / 目录**锁 |
| 首次发现 | 2026-11-01（r125 · C 组 · 「职业与去向」轴 · 交叉词 `dsh plugin resume job`，total=4 命中 2 个） |

---

## 判据③ 的三条证据（本轮沙箱实跑，不是读 README 相信它）

### ① 零依赖 docx 解析

上游 `resume.js` 自己实现 ZIP 中央目录扫描（`EOCD` 0x06054b50 回溯 + `0x02014b50` 遍历），
再读 `word/document.xml` 去标签。**本仓没有任何 docx 读取库。**

实跑（造一个最小 docx 喂进去）：

```text
zip entries: [ 'word/document.xml' ]
docx text -> "张三 · 浙江大学\n熟悉 TypeScript 与 Python\n"
```

### ② PDF `ToUnicode` CMap —— 两个真实陷阱，实测都对

中文 PDF 若由 Word/WPS 导出，字体多为 `Type0` / `Identity-H`，**必须**按每个字体自己的
`ToUnicode` CMap 把字形码还原成汉字，否则取到的是乱码。

| 陷阱 | 它的处理 | 我的复现 |
| --- | --- | --- |
| **数组式 `bfrange`**：`<4E13> <4E15> [<5f20> <4e09> <674e>]` 里相邻的 `<hex> <hex> <hex>` 会被误读成**递增区间**（start=0x4E13 end=0x4E1A），污染整个编码空间 | **先**处理数组式，并把它**替换成空格抹掉**，再跑递增式 | `array-form => 3 entries; 4E13=张 4E14=三 4E15=李` ✅ |
| **递增式 `bfrange`**：`<0010> <0012> <674E>` | `fromCodePoint(dst + (code - start))` | `10=李 11=杏 12=材` ✅ |
| **多字体串字**：不同子集里相同编码指向不同汉字 | 按 `/Fx n Tf` **跟踪当前字体**，各读各的 `ToUnicode` | 代码注释明写，`readCMap` 由 `pdfToText` 逐字体调用 |

> 第 1 条是 PDF 文本抽取**最经典的错**：先跑递增式就会把 `<4E13> <4E14>` 吃成区间，
> 结果是「看着能出字、其实大面积乱码」。它逆序处理并写进了注释 —— 这是**实践经验**。

### ③ 简历打分 + 桥接岗识别

`careers.js` 文件头自陈 *"Pure data + pure functions: no network, no Cordis APIs"*，
加权口径透明（读自 `scoreCareer`）：

```text
技能命中×34（最多算 4 项）+ 经验相通×24（销售/PM 兜底 8，其他 4）
+ 学历×14 + 年限×12 + 技能广度(≥4)×12→6
− 学历级差≥2 扣 12；年限差×6；samePath 且非目标岗扣 8
+ 桥接岗（同时用上现有经验与目标方向）+6
```

---

## 本包相对上游的**四处**增量（都在兼容层做，不改上游）

| # | 增量 | 为什么必须做 |
| --- | --- | --- |
| 1 | **简历不出本机**（TODO-1） | 上游 `job_search({resumePath})` 会把技能并入 `ctx.web` 检索词 → **简历事实上外发** |
| 2 | **机器可读首行**（TODO-3） | `SCORES: match=… recommendation=…`，口径借自 `Gsync/jobsync`（MIT）；便于流式渲染与断言 |
| 3 | **在校生档位**（TODO-4） | 上游 `CAREERS` 是**社招**口径（"可转型"对在校生是噪声） |
| 4 | **简历侧也检隐藏字符**（TODO-5） | 上游与 `resume-llm/resume-ai` 都**只检 JD**，不检简历被反向塞词 |

---

## 隐私红线（必须写进产品文案）

- `job_search` 走 `ctx.web` 检索；`index.js` 里还**绕过 `HTTP_PROXY`** 直连招聘站
  （注释说桌面版带了个死代理）。
- 因此本包规定：**外发白名单只有 `cities` + 技能标签**（`toSearchSafeProfile`，TODO-B）。
  学校、专业、姓名、公司、项目描述、任何原文片段**一律不出去**。
- 上游限制：图片/扫描版 PDF **读不出**（无文字层），会直接报「简历里没有读到文字」；
  无 `ToUnicode` 的 PDF（某些打印驱动）中文仍可能取不到 → **换 `.docx` 最稳**。

---

## 伦理边界（沿用 `1bailan/dsh-plugin-boss-zhipin` 自设红线的**精神**）

- **只读**：只回答「投什么、差什么」，**不代投**（`allowApply()` 恒 `false`）。
- 不绕验证码、不绕风控、不绕每日上限、不批量。
- 不为装插件而放宽 DSH 沙箱到 `danger-full-access`。

---

## 需要人工拍板的事

1. **TODO-0（阻塞，否决即删目录）**：落在「**规划**」页还是「今天」页？
   若产品要独立的「求职」页 → 判据①（仍是同一个面板）**不成立**，本骨架应直接驳回。
2. **TODO-1（阻塞）**：检索词里到底能放什么？本包主张**只放城市 + 技能标签**。
3. **TODO-2**：永远只读，还是允许「生成投递材料」？（后者不写账号，只产出文件，可以考虑。）
4. **TODO-3**：`SCORES:` 首行契约要不要内联？内联则同时要抄它的**流式半行遮罩**。
5. **TODO-4**：`CAREERS` 知识库换一份在校生版的成本有多大？若太大，本条降级为「只用 `job_search`」。
6. **TODO-A（挂法）**：`github:…#1.2.2` 还是 vendor 到 `vendor/`？
   **绝不能写 `^1.2.2`** —— 上游 ★0、建仓 2 天，且涉及外发简历事实，升级必须人看 diff。

## 硬边界

- **不改上游源码**；本包只做外围兼容层。
- **不搬上游代码**：`src/` 里只有**契约**（函数名、参数、返回、口径），没有一行上游实现。
- **无测试**：上游自带 `test/*.mjs` 4 个，**不进本仓**。
- **不写 profile**；`Owner: shared`；包名带 `dsh-radar-` 前缀；锁版**不用 `^`**。
- **不新建面板**：落点是既有行、既有路由。
