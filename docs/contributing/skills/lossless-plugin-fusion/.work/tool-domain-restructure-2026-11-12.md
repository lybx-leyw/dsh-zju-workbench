# `packages/tool/` 按域重构（2026-11-12）

> **一句话**：把 2 个混装包（`campus-write` 装 7 个域、`study` 名不副实）
> 拆成 **1 个共享底座 + 8 个按域包**，与 `source/*` 一一对应。

---

## 一、改之前是什么样

```text
packages/tool/
  campus-write/   7 个工具，横跨 7 个数据源
  study/          3 个工具，读的是智云课堂讲义
```

两个问题：

| # | 问题 | 具体代价 |
| --- | --- | --- |
| 1 | `campus-write` 一个包装 7 个域 | 想只给「选课」的能力，得把发帖、交作业、场馆预约一起给出去 |
| 2 | `study` 与 `core/study` 同名，但指不同的东西 | 它读的是**课堂讲义**，`core/study` 是**学习空间聚合页** |

**还有一件更基础的事**：`campus-write` 当时**根本没被挂载** ——
preset 里 0 处、profile 里 0 处、`.runtime` profile 55 个 bundle 里 0 处。
所以那 7 个写工具一个都到不了 agent（`D11` 的后果）。
**这也意味着这次重构的运行时风险为零**：反正没在用。

---

## 二、改之后是什么样

```text
packages/tool/
  write-kit/   共享底座（不是插件：无 apply、无 patch、不注册工具）
  zdbk/        campus_course_select
  sztz/        campus_activity
  tyys/        campus_venue
  xuezai/      campus_homework, campus_checkin
  pta/         campus_answer
  cc98/        campus_post, campus_react, campus_signin
  lab/         campus_lab_select
  classroom/   study_catalog, study_read, study_search
```

与 `source/*` 一一对应：`source/zdbk` ↔ `tool/zdbk`。

### `write-kit` 装什么

| 导出 | 作用 |
| --- | --- |
| `guardWrite` / `requireApproval` / `WriteRejected` / `WRITE_CODES` | 审批封装，只有 `allowed-once` 放行 |
| `createWriteToolRegistrar` | 工具注册器：接好 source 的 prepare / execute / cancel 三段 |
| `contractOf` / `serviceLookup` / `inputError` / `str` / `optStr` | 契约校验与参数校验的公共小件 |

抽出来的判据：**写一遍就够、写第二遍就会漂**的东西。审批尤其如此 ——
若让每个工具自己写「先 request 再 act」，忘掉一次就是一次无审批写入，
而那种漏洞不会表现为报错。

---

## 三、这次顺带修掉的真 bug

重构不只是搬文件。按「**source 做完整的基础函数，tool 做封装**」这条口径
重新过了一遍跨层契约，`node scripts/probe-write-contract.mjs` 从 22 条里 8 条不通
变成 **28 条全通**：

| # | 症状 | 修法 | 为什么修 source 而不是 tool |
| --- | --- | --- | --- |
| T-1/T-2 | `zdbk drop`/`reorder` 工具传 `{course}`，source 要 `section` | `source/zdbk` 新增 `findChoice()`，两种都收 | 「志愿表里哪个字段是课程名」是**这个数据源的知识**，不该让每个调用方各查一遍 |
| T-3/T-4 | `xuezai` 交/撤作业工具传作业名，source 只认数字 id | `resolveActivity` 收 id、名称、对象 | 同上；且重名时要给候选而不是替用户挑 |
| — | `tyys` 预约工具传 `slot: '19:00-20:00'`，source 要 `start`+`end` | source 拆 `slot` | 「时段是什么形状」是数据源的知识 |
| — | `lab` 选实验工具传课程名，source 的 `id()` 只收正整数 | source 按名称解析课程 | 用户手里只有名字 |
| — | `xuezai` 点名工具传 `{course}`，source 读 `args.rollcall` | source 也收 `course` | 点名行与作业行在同一个待办表里 |

### 「不猜」的两处

| 场景 | 行为 |
| --- | --- |
| 同一门课有 2 个志愿（第一、第二志愿），只按课程名退课 | **拒绝**并列出候选，要 `section` 指定 —— 猜错等于替他退错了班 |
| 同名作业 / 同名实验课 | **拒绝**并列出候选 —— 猜错等于交了另一份作业 |

---

## 四、错的是我之前的框架

我之前把 `D17`（写操作进 `tool/`）理解成**职责划分**：source 只管读、
写归 tool，那么 source 的写函数不完整也没关系。

**这个理解是错的。写操作本质就是函数**：

| 层 | 该做什么 |
| --- | --- |
| `source` | **完整的基础函数**：参数全收，接受用户能给出的各种形式 |
| `tool` | **现成的封装**：把用户话术翻成参数、校验、审批、暴露给模型 |

所以：

- 「参数名对不上」不是分工问题，是**接线错误**；
- 「source 少收字段」不是「归他处了」，是**基础函数不完整**。

`coverage-audit-batch-a.md` 里那 8 条 D（归他处）就是按错框架记的。
其中 7 条已在这一轮修掉。

---

## 五、验证

| 手段 | 结果 |
| --- | --- |
| `node scripts/probe-write-contract.mjs` | **28/28 通**（重构前 22 条里 8 条不通） |
| `tests/tool/**` | **46 条全绿** |
| `tests/repo/**` | **130 条**，129 通过 1 skip 0 失败 |
| `tests/source/{zdbk,xuezai,tyys,lab,cc98}` | **596 条全绿** |
| `npm run build` | 通过 |

**反证**（改坏实现确认测试会红，这是本仓的强制要求）：

| 改坏什么 | 期望红 | 实际 |
| --- | --- | --- |
| `nopermit` 判定改成 `false` | webvpn probe | ✅ 红 1 |
| 去掉 TUN 检测 | webvpn probe | ✅ 红 1 |
| TTL 改成永不命中 | webvpn reach | ✅ 红 2 |
| 匿名/标签写回常量 | cc98 writes | ✅ 红 3 |
| 去掉赞踩取消语义 | cc98 writes | ✅ 红 1 |
| 封装层只传 `board+content` | campus-write | ✅ 红 1 |
| `zdbk` 按名解析去掉 | 探针 | ✅ 红 1 |
| `tyys` slot 拆分去掉 | 探针 | ✅ 红 1 |
| action 校验挪到 `need()` 之后 | domain packages | ✅ 红 1 |

---

## 六、没做的

| 项 | 为什么 |
| --- | --- |
| 图片上传（`cc98 post`/`reply`） | 多段上传（先传图拿 id 再带 id 发帖），比补参数重得多 |
| 「先认 action 再取服务」的守卫 | 已按包落实，但没有一条测试枚举**所有**包的所有 action —— 现在是靠 `domain-packages.test.mjs` 抽查第一个 action |
| `campus_checkin` 的 `rollcall` 用课程名 | source 现在收 `course`，但待办表里的点名行标题是「课程名 + 点名」，匹配靠 `includes`，可能过宽 |

---

## 七、历史文档怎么处理

`docs/contributing/skills/lossless-plugin-fusion/.work/` 下约 20 份文档引用了
`tool/campus-write` 与 `tool/study`。**这些引用一律不改**：它们是当时的取证记录，
行号与包名都是那一刻的事实，改掉会让「当时为什么这么判」失真。

只有在**描述现状**的地方才更新（`upstream-gap-audit-2026-11-12.md` §2.1 末尾、
`coverage-audit-batch-a.md` 的汇总表）。
