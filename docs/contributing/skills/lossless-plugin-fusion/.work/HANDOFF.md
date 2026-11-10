# 融合进度与交接说明

> **给接手的人的第一份文档。** 这份说明「现在到哪了、还差什么、怎么接着做」。
> 缺口明细在 [`coverage-gaps.md`](coverage-gaps.md)，那才是唯一权威的缺口记录；
> 决定不要的东西在 [`abandoned.md`](abandoned.md)（遗弃记录 + 裁决落地核对）。

最后更新：2026-11-11

---

## 零、先说三条本轮改掉的旧结论（别照着旧文档干）

| # | 旧文档说的 | 实际 |
| --- | --- | --- |
| 1 | 「数据源层已完成」 | **数据源包建完了、实机上多数用不了**：`lab` / `tyys` / `sztz` / `mail` / `yjsy` / `notice` 六个包的凭据注入口没人调用，挂载后 `ready()` 全是 `false`（见 [`abandoned.md`](abandoned.md) A-4）；`tool/campus-write` 既不在 profile 也不在 preset，**22 条写能力在实机上没有入口** |
| 2 | 写操作的接线断裂「已修」（Y-2 / Y-5 / Y-6） | **只修到 source 边界**。用 `node scripts/probe-write-contract.mjs` 按工具层实际传的参数再测一遍：**22 条探针通 14、不通 8**（`coverage-gaps.md` 第八节，Y-7 ~ Y-12）。退课/调序、场馆预约、交/撤作业、点名、CC98 评分、选实验**点了就报错** |
| 3 | 审计基线「12 个模块、121 条 provides」 | 无法复现。重算是 **17 个有 `module.json` 的模块、162 条 provides**（两种算法一致）。两份审计只覆盖 147 条；`doc`（4 条）与 `zjuam`（3 条）**没有任何审计**，`doc` 里有 3 条完全没有承接方 |

---

## 一、一句话现状

**18 个数据源包全部建完并挂进 profile；写操作实现了 22 条；但装配层（谁能用）与
工具层的参数契约还没打通，所以实机上「能读到东西」的只有 4 个数据源。**

已建成：`source/` 22 个包（4 个 tier 0 + 15 个数据源 + 3 个 agent skill）、
`tool/campus-write`（7 个工具 / 22 条写操作）、`tool/study`。
**未建**：proc 层 11 个包、`tool/` 其余 6 个包、`preset/campus`、`skill/zju-campus`、7 个页面。

---

## 二、已完成（有测试、有提交）

### 2.1 基础设施（tier 0，4 个）

| 包 | 作用 |
| --- | --- |
| `source/http` | 传输层 + `zhiyunEgress`（出口策略服务） |
| `source/webvpn` | 网关登录、主机归属表、诊断、`probe-hosts.mjs` |
| `source/login` | 「浙大一卡通」CAS 取票（D18 抽出，供所有 CAS 数据源共用）+ CC98 独立账号 |
| `source/netproxy` | **未挂 profile** —— 分域网络代理中继，按需启用 |

### 2.2 数据源（15 个 tier 1 包）

| 包 | 读方法 | 写方法 | 装配 / 写契约状态 |
| --- | --- | --- | --- |
| `zdbk` | 12 | 3 | 自己读凭据（不需装配方）；select ✅ / drop·reorder ✗（Y-7） |
| `cc98` | 22 | 8 | 自己读凭据；7 个写动作 ✅ / rate ✗（Y-11） |
| `xxt` | 12 | 0 | 自己读凭据（Cookie） |
| `classroom` | 22 | 0 | 自己读凭据；读依赖 `profileContext`；`trans audio` 缺内核（漏-4） |
| `xuezai` | 6 动作 | 3 | 自己读凭据；submit·retract ✗（Y-9）/ rollcall ✗（Y-10） |
| `pta` | 5 动作 | 2 | 自己读凭据（Cookie）；写需先在网页开始答题（上游同款） |
| `lab` | 10 | 2 | ❌ **未注入凭据**（`ready()=false`）；cancel ✅ / select ✗（Y-12） |
| `sztz` | 6 | 2 | ❌ **未注入登录**；两个写动作契约 ✅ |
| `tyys` | 7 | 2 | ❌ **未注入账号**；cancel ✅ / book ✗（Y-8） |
| `notice` | 4 | 0 | ❌ **未注入 CAS 登录**；匿名可读但 9 个来源里需要登录的那部分读不到（实测 `status: partial`，`incomplete: 11`） |
| `yjsy` | 1 | 0 | ❌ **未注入 token** |
| `mail` | 8 | 0 | ❌ **未注入专用密码** |
| `chalaoshi` | 3 | 0 | 无凭据需求（站点国内不可达，有缓存时可用） |
| `ebook` | 1 | 0 | 无凭据需求 |
| `cnki` | 2 | 0 | 无凭据需求（按 IP 认机构）；下载未实现（W-10） |

> 「自己读凭据」= 直接 `import { readCard } from '@lybx-leyw/dsh-zju-source-login'`，
> 不需要装配方；「未注入 X」= 等 `setXxxProvider`，而那个调用方不存在（`abandoned.md` A-4）。
>
> ⚠️ **这批结论的证据强度**：静态 grep + 最小替身 ctx 实测。**没有**用真实账号在真实
> profile 上跑过任何一次调用。`zdbk`/`cc98`/`xxt`/`classroom` 的 `apply()` 需要
> `ctx.profileContext`，替身里没有，所以那几行只验证到「代码会去读宿主凭据服务」，
> 没验证到「真能取到数据」。

### 2.3 三个 agent skill 包（**不挂 profile**，D19）

`wechat-chat` / `dingtalk-chat` / `weread` —— agent skill（`SKILL.md` + `bin` CLI），
没有 `main`/`exports`，**不能有 `cordis.patch.yml`**。发现机制见 D20（待裁决）。

### 2.4 tool 层（2 个）

`tool/campus-write` —— **7 个工具收 22 条写操作**（列表见下），审批走宿主 `ctx.approval`：

| 工具 | 收的上游写能力 | 实测参数契约 |
| --- | --- | --- |
| `campus_course_select` | zdbk 选课 / 退课 / 调序 | select ✅ / drop ❌ / reorder ❌ |
| `campus_activity` | sztz 报名 / 取消 + tyys 预约 / 取消 | sztz ✅✅ / tyys book ❌ / cancel ✅ |
| `campus_homework` | xuezai 交作业 / 撤回 + pta 保存 / 提交 | xuezai ❌❌（传名字）/ ✅ pta |
| `campus_checkin` | xuezai 签到 + cc98 签到 | xuezai ❌ / cc98 ✅ |
| `campus_post` | cc98 发帖 / 回帖 / 编辑 / 私信 | ✅ 4/4 |
| `campus_react` | cc98 点赞 / 评分 / 收藏 | ✅✅ / rate ❌ |
| `campus_lab_select` | lab 选实验 / 退选 | cancel ✅ / select ❌ |

`tool/study` —— 讲义 / 黑板 / 材料的浏览与检索（挂进 `preset/lecture`）。

---

## 三、核心设计（改代码前必读）

### 3.1 三层分工

| 层 | 能放什么 | 不能放什么 |
| --- | --- | --- |
| `packages/source/*` | 连外部站点、只提供事实 | 变换、跨会话状态、UI、**审批** |
| `packages/core/*` | 变换、状态、路由 | **数据源**（不连外部站点） |
| `packages/tool/*` | agent 工具注册 + 审批 | 业务实现 |
| `packages/client/*` | 只含 UI | 数据获取 |

### 3.2 写操作的**两段式契约**（最重要的约定）

每个写动作在 source 里是**两个方法**：

```js
// source 侧
xxxPrepare(args)  →  查库、算 id、拼表单、返回一句给人看的说明   // 不发写请求
xxxExecute(signal) →  把算好的东西发出去                        // 会改变状态
```

`tool/campus-write` 调 Prepare → 审批 → 调 Execute。
**审批在 tool 层，source 不做审批**（它不知道什么叫 turn、什么叫审批通道）。

三条硬约束：

1. **Prepare 绝不发写请求** —— 否则用户还没看到对话框，帖子已经发出去了。
2. **并发 Prepare 会被拒** —— 共用一个 session 会让「批准的是 A，发出去的是 B」。
3. **fail closed** —— 没有审批通道就**不做**，不默认允许。

### 3.3 平台知识归 source，不推给调用方

`zdbk` 选课的 `pool`（课程号）/ `category`（页签码）是正方内部概念，
只能从课程列表查询拿到。**调用方只给课程名，source 自己解析。**
同名多门课时**不许猜**，列候选让用户指定。

同类：`cc98.sendMessage` 收用户名，source 自己查 id。

### 3.4 三处「看起来实现了但跑不通」的教训

审计查出 8 处接口断裂。根因都是**工具与 source 的参数名/语义不匹配**，
而那种缺陷不会报错 —— 只在调用时抛，或**静默丢弃输入**。

**本轮新增第 9~15 处，且证实了更要紧的一件事**：这些断裂**测试抓不到**，
因为工具层的测试用假 source、source 层的测试按 source 的写法给参数。
修的时候必须**用工具层真实传的那个对象**再测一遍，否则「红 3 条 ✅」只证明 source 内部自洽。

---

## 四、还剩什么

### 4.1 proc 层（11 个包，0 个已建）

`impl-plan.md` 第 2 层的 `campus-calendar` / `campus-schedule` / `campus-affairs` /
`campus-feed` / `campus-notice-filter` / `campus-notice-content` / `campus-alerts` /
`campus-context` / `campus-store` / `campus-learning` / `campus-approval-bridge`
—— `packages/core/` 里 grep `campus-` **零命中**。

其中 **P2-10（学习页聚合）就是 Q-D**，你已裁决「移出数据源范围」；
但 proc 层整体怎么定**仍需裁决**（`abandoned.md` 的 Q-7）。

### 4.2 tool 层其余 6 个包

| 包 | 收什么 | 状态 |
| --- | --- | --- |
| `tool/zju` | 综合入口（上游 `zju-tool.mjs`） | 未建 |
| `tool/campus` | profile / note / schedule / context / notify | 未建（依赖 proc 层） |
| `tool/mail` | 查信 + 发信（发信走审批） | 未建（D9 的 9-2） |
| `tool/campus-wechat` | `campus_wechat` | 未建 |
| `tool/campus-chat` | 微信/钉钉聊天 | 未建 |

**注入点约定**：工具包**不带挂载行、不进 profile bundles** —— 可见范围由 preset 决定。
⚠️ `tool/campus-write` 按这条没进 profile，但 preset 也没建，所以**它现在不加载**。

### 4.3 preset（D11 延迟）

已查明机制：preset 是**独立的 Cordis scope 子树**，不是「过滤全局工具表」。
落地时必须**新建 `packages/preset/campus`**，不能改现有 preset（没有 preset patch 能力）。

### 4.4 页面（7 项，D14/D15 已定）

骨架用 dsh-pages 的 `page.content`，数据通道一律改接本仓 core/source。
**一项都还没移植**（`abandoned.md` 的 Q-9）。

### 4.5 覆盖度缺口

**约 30 条待补 + 8 处遗弃了一半**，全部在 [`coverage-gaps.md`](coverage-gaps.md) 与
[`abandoned.md`](abandoned.md)：

| 类 | 条数 | 代表 |
| --- | --- | --- |
| X 死链（**已修**） | 2 | `pta` exam 死链、deadline 校验失效 |
| Y 接线断裂（**source 侧已修，工具侧仍有 9 处**） | 6 + 7 | `tyys` 漏 import、`zdbk` 参数契约、`campus_checkin` 给不到点名编号 |
| W 能力缺口 | 30 | `xxt` 资料栏、`classroom setup`、`pta` start/finish |
| A 遗弃了一半（**承接方不存在**） | 8 | D21 的下载执行方、六个包的凭据注入口 |
| D 行为差异 | 12 | `classroom live` 进程内 vs 后台进程 |

---

## 五、接手前必须知道的八件事

| # | 事项 |
| --- | --- |
| 1 | **不要跑 `npm install`** —— 用 `npm ci --include=dev` + `node scripts/link-workspace-packages.mjs`。`NODE_ENV=production` 时会漏装 devDependencies，测试会报 `Cannot find package 'js-yaml'` |
| 2 | **提交前必须做泄露检查** —— 本仓库是公开的，检查本地绝对路径、学号、凭据 |
| 3 | **提交与推送前必须先问用户** —— 不要自行 commit |
| 4 | **本仓是公开仓库**，测试夹具与注释也会被看到 |
| 5 | 全仓基线有 **26 个既有失败**（`ref/OpenMAIC` 目录缺失、`pptx` 依赖、`tests/zdbk.test.mjs` 的 patch 正则、PDF 渲染用例挂住）。**不是你的改动引起的** |
| 6 | **注释里不许写「不做 / 丢弃 / 不搬运」，除非能指向一条编号裁决** —— 见 `coverage-gaps.md` 第五节与 `abandoned.md` 第二节 |
| 7 | **「引用一条裁决」不等于「问题已解决」** —— D21 说了下载归 core，core 里没有；D9 说了拆 4 个包，3 个没建。见 `abandoned.md` 第三节 |
| 8 | **改完写操作，必须用工具层真实传的参数再测一遍** —— 只测 source 的 `prepare()` 会漏掉整类缺陷（第八节） |

---

## 六、验证命令

```bash
# 单项
node --test tests/zdbk.test.mjs

# 全仓（会看到 26 个基线失败；PDF 渲染那条会挂住，建议加超时）
timeout 600 npm test

# 守卫（能力声明 / 设置分区 / 发布 / patch）
node --test tests/source-capability.test.mjs tests/source-settings.test.mjs \
          tests/publish-guard.test.mjs tests/patch-yaml.test.mjs

# 工作区链接（期望 66/66）
node scripts/link-workspace-packages.mjs --check

# 写操作的实际契约（不是跑测试，是喂工具层真实参数）
#   期望：通 14 / 不通 8（8 条不通是本轮记录的已知断裂）
node scripts/probe-write-contract.mjs
```

---

## 七、关键文件导航

| 想看什么 | 去哪 |
| --- | --- |
| **还差什么** | [`coverage-gaps.md`](coverage-gaps.md) |
| **决定不要什么、裁决落地了没** | [`abandoned.md`](abandoned.md) |
| 整体实施清单（806 行） | [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) |
| 裁决汇总（D1–D21） | 同上，第 32 行起 |
| 上下游覆盖度审计 | [`coverage-audit-batch-a.md`](coverage-audit-batch-a.md)（76 条）、[`coverage-audit-batch-b.md`](coverage-audit-batch-b.md)（71 条） |
| 分层与写操作契约 | 本文件第 3 节 |
| 上游原始代码 | `packages/vendor/zju-assistant/core/zju/lib/` |

