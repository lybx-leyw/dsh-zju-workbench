# 融合进度与交接说明

> **给接手的人的第一份文档。** 这份说明「现在到哪了、还差什么、怎么接着做」。
> 缺口明细在 [`coverage-gaps.md`](coverage-gaps.md)，那才是唯一权威的缺口记录。

最后更新：2026-11-11

---

## 一、一句话现状

**数据源层（18 个包）+ 写操作层（7 个包的写方法 + `tool/campus-write`）已完成并提交。**
剩余：proc 层 9 个包、tool 层其余 5 个包、preset、7 个页面。

---

## 二、已完成（有测试、有提交）

### 2.1 基础设施（tier 0，4 个）

| 包 | 作用 |
| --- | --- |
| `source/http` | 传输层 + `zhiyunEgress`（出口策略服务） |
| `source/webvpn` | 网关登录、主机归属表、诊断 |
| `source/login` | 「浙大一卡通」CAS 取票（D18 抽出，供所有 CAS 数据源共用） |
| `source/netproxy` | **未挂 profile** —— webvpn 优化后已被替代 |

### 2.2 数据源（18 个，全部已挂 profile）

| 包 | 读方法 | 写方法 | 说明 |
| --- | --- | --- | --- |
| `zdbk` | 12 | 3 | 教务网：成绩/考试/课表/培养方案/选课查询 + 选课/退课/调序 |
| `cc98` | 22 | 8 | 论坛：读 + 发帖/回帖/私信/赞踩/评分/收藏/签到 |
| `xxt` | 12 | 0 | 学习通：课程/作业/考试/通知/课表/章节/附件清单/下载参数 |
| `classroom` | 22 | 0 | 智云课堂：课件/字幕/资源/诊断/实时字幕/ASR 编排 |
| `xuezai` | — | 3 | 学在浙大：待办 + 交作业/撤回/签到 |
| `pta` | — | 2 | 拼题A：题集/题目/进度 + 保存/提交答案 |
| `lab` | 10 | 2 | 实验选课：课程/班次/已选 + 选/退 |
| `sztz` | 6 | 2 | 二课：活动/项目/学分 + 报名/取消 |
| `tyys` | 7 | 2 | 体育：场馆/时段/订单/考勤 + 预约/取消（含验证码） |
| `notice` | 4 | 0 | 通知汇总（9 个来源） |
| `yjsy` | 1 | 0 | 研究生教务课表 |
| `chalaoshi` | 2 | 0 | 查老师 |
| `ebook` | 1 | 0 | 电子书检索 |
| `cnki` | 2 | 0 | 知网检索 |
| `mail` | 8 | 0 | 邮箱 IMAP/SMTP（只读；发信归 `tool/mail`） |

### 2.3 三个 agent skill 包（**不挂 profile**，D19）

`wechat-chat` / `dingtalk-chat` / `weread` —— 它们是 agent skill（`SKILL.md` + `bin` CLI），
没有 `main`/`exports`，**不能有 `cordis.patch.yml`**。发现机制见 D20（待裁决）。

### 2.4 tool 层（1 个）

`tool/campus-write` —— **7 个工具收 22 条写操作**：

| 工具 | 收的上游写能力 |
| --- | --- |
| `campus_course_select` | zdbk 选课 / 退课 / 调序 |
| `campus_activity` | sztz 报名 / 取消 + tyys 预约 / 取消 |
| `campus_homework` | xuezai 交作业 / 撤回 + pta 保存 / 提交 |
| `campus_checkin` | xuezai 签到 + cc98 签到 |
| `campus_post` | cc98 发帖 / 回帖 / 编辑 / 私信 |
| `campus_react` | cc98 点赞 / 评分 / 收藏 |
| `campus_lab_select` | lab 选实验 / 退选 |

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

写新工具时务必：**对着 source 的实现逐参数核对**，不要只看方法名。

---

## 四、还剩什么

### 4.1 proc 层（9 个包，0 个已建）

见实现清单第 2 层。其中 **P2-10（学习页聚合）就是 Q-D**，你已裁决「移出数据源范围」，
但 proc 层整体怎么定**仍需裁决**。

### 4.2 tool 层其余 5 个包

| 包 | 收什么 |
| --- | --- |
| `tool/zju` | 综合入口（上游 `zju-tool.mjs`） |
| `tool/campus` | profile / note / schedule / context / notify |
| `tool/mail` | 查信 + 发信（发信走审批） |
| `tool/campus-wechat` | `campus_wechat` |
| `tool/campus-chat` | 微信/钉钉聊天 |

**注入点约定**：工具包**不带挂载行、不进 profile bundles** —— 可见范围由 preset 决定。

### 4.3 preset（D11 延迟）

已查明机制：preset 是**独立的 Cordis scope 子树**，不是「过滤全局工具表」。
落地时必须**新建 `packages/preset/campus`**，不能改现有 preset（没有 preset patch 能力）。

### 4.4 页面（7 项，D14/D15 已定）

骨架用 dsh-pages 的 `page.content`，数据通道一律改接本仓 core/source。
详见实现清单第 4 层。

### 4.5 覆盖度缺口

**约 30 条**，全部在 [`coverage-gaps.md`](coverage-gaps.md)：

| 类 | 条数 | 代表 |
| --- | --- | --- |
| X 死链（**已修**） | 2 | `pta` exam 死链、deadline 校验失效 |
| Y 接线断裂（**已修**） | 6 | `tyys` 漏 import、`zdbk` 参数契约 |
| W 能力缺口 | 约 20 | `xxt` 资料栏、`classroom setup`、`pta` start/finish |
| D 行为差异 | 12 | `classroom live` 进程内 vs 后台进程 |

---

## 五、接手前必须知道的六件事

| # | 事项 |
| --- | --- |
| 1 | **不要跑 `npm install`** —— 用 `npm ci` + `node scripts/link-workspace-packages.mjs`。原因见 `docs/contributing/AGENTS.md` |
| 2 | **提交前必须做泄露检查** —— 本仓库是公开的，检查本地绝对路径、学号、凭据 |
| 3 | **提交与推送前必须先问用户** —— 不要自行 commit |
| 4 | **本仓是公开仓库**，测试夹具与注释也会被看到 |
| 5 | 全仓基线有 **27 个既有失败**（`ref/OpenMAIC` 目录缺失、`pptx` 依赖），不是你的改动引起的 |
| 6 | **注释里不许写「不做 / 丢弃 / 不搬运」，除非能指向一条编号裁决** —— 见 `coverage-gaps.md` 第五节，我犯过这个错 |

---

## 六、验证命令

```powershell
# 单项
node --test tests/zdbk.test.mjs

# 全仓（会看到 27 个基线失败）
npm test

# 守卫（能力声明 / 设置分区 / 发布 / patch）
node --test tests/source-capability.test.mjs tests/source-settings.test.mjs `
          tests/publish-guard.test.mjs tests/patch-yaml.test.mjs

# 工作区链接（期望 66/66）
node scripts/link-workspace-packages.mjs --check
```

---

## 七、关键文件导航

| 想看什么 | 去哪 |
| --- | --- |
| **还差什么** | [`coverage-gaps.md`](coverage-gaps.md) |
| 整体实施清单（806 行） | [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) |
| 裁决汇总（D1–D21） | 同上，第 32 行起 |
| 上下游覆盖度审计 | [`coverage-audit-batch-a.md`](coverage-audit-batch-a.md)（76 条）、[`coverage-audit-batch-b.md`](coverage-audit-batch-b.md)（71 条） |
| 分层与写操作契约 | 本文件第 3 节 |
| 上游原始代码 | `packages/vendor/zju-assistant/core/zju/lib/` |
