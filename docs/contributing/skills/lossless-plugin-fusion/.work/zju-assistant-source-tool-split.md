# 数据源与工具的分层规则（D17 裁决）

**裁决人**：用户（2026-11-10）
**裁决原文**：
> 读写混装拆包，写操作显然必须接入 tool，直接注册成 AI tool，归为 tool 插件包的职责。
> 读操作直接注册成数据源即可。`source/classroom` 同理拆包。

---

## 一、规则本身

**「读」与「写」不是同一个包的两半，而是两个不同层的职责。**

| 层 | 收什么 | 形态 |
| --- | --- | --- |
| `packages/source/*` | **只读**的数据获取 | provide 一个服务 + 一条同源数据路由；**不注册 AI 工具** |
| `packages/tool/*` | **写**操作 | `ctx.tools.register(defineTool(...))`，走 `ctx.approval` 审批 |
| `packages/core/*` | 变换、状态、跨源聚合 | 不连外部站点 |
| `packages/client/*` | 只含 UI | 不取数 |

### 这条规则解决什么

`source/campus` 的注释自己写着「本包是**数据包**：注册一个 `zhiyunZdbk` 服务与一条
同源数据路由，**不注册任何 AI 工具**」（`packages/source/zdbk/cordis.patch.yml`）。
但 `cc98` 现有 10 个只读方法、上游 32 条里有 7 条写；`classroom` 17 个方法里
`downloadSlides` / `downloadResource` 是下载，上游还有 ASR 与长连接实时字幕。

**混装的具体害处**：

1. 数据源包的 peer 依赖里不需要宿主 `tools`/`approval`，混装就得加 —— 而 tier 1 的
   数据源不该依赖 `ctx.approval`；
2. 写操作必须「在 turn 内」才能审批（`user-approval/src/index.ts:244`），
   而数据源包是被后台任务（`feed.start()` 等）调用的，两者生命周期不同；
3. 「这个包会不会改我的账号状态」从包名看不出来 —— 拆开之后 `source/*` 永远只读，
   这是可审计的性质，不是约定。

---

## 二、按此规则重新划分的包

### `packages/source/*`（只读，14 个新建 + 4 个扩展）

| # | 目录 | 包名 | 读操作来源 | 写操作去向 |
| --- | --- | --- | --- | --- |
| 1 | `yjsy/` | `dsh-zju-source-yjsy` | 全部（1 条） | 无 |
| 2 | `xuezai/` | `dsh-zju-source-xuezai` | 课程/课件/作业列表/待办/点名记录 | → `tool/campus-write` |
| 3 | `pta/` | `dsh-zju-source-pta` | 题集/题目/提交列表/进度 | → `tool/campus-write` |
| 4 | `notice/` | `dsh-zju-source-notice` | 全部（4 条，含 68 主机表） | 无 |
| 5 | `sztz/` | `dsh-zju-source-sztz` | 活动/项目/记点/公告 | → `tool/campus-write` |
| 6 | `tyys/` | `dsh-zju-source-tyys` | 空场/预约须知/订单列表/考勤 | → `tool/campus-write` |
| 7 | `lab/` | `dsh-zju-source-lab` | 课表/课程/实验/已选/公告 | → `tool/campus-write` |
| 8 | `chalaoshi/` | `dsh-zju-source-chalaoshi` | 全部（3 条） | 无 |
| 9 | `ebook/` | `dsh-zju-source-ebook` | 全部（1 条） | 无 |
| 10 | `cnki/` | `dsh-zju-source-cnki` | 检索/全文 PDF 下载 | 无 |
| 11 | `mail/` | `dsh-zju-source-mail` | 收信/读信/附件/草稿列表 | → `tool/mail`（发信） |
| 12 | `weread/` | `dsh-zju-source-weread` | 读文章/列号/存 Markdown | 无 |
| 13 | `wechat-chat/` | `dsh-zju-source-wechat-chat` | 群聊/私聊/联系人/附件 | 无 |
| 14 | `dingtalk-chat/` | `dsh-zju-source-dingtalk-chat` | 同上（v2/v3 账号库） | 无 |
| E1 | `cc98/`（扩展） | `dsh-zju-source-cc98` | 只保留 21 条**只读** | → `tool/campus-write` |
| E2 | `classroom/`（扩展） | `dsh-zju-source-classroom` | 查询类 + 下载类 | 无 |
| E3 | `xxt/`（扩展） | `dsh-zju-source-xxt` | 全部（含新增课件视频清单） | 无 |
| E4 | `zdbk/`（扩展） | `dsh-zju-source-zdbk` | 成绩/GPA/考试/课表/培养方案/学籍/**选课查询** | → `tool/campus-write` |

**注意 `classroom` 的一条例外**：`downloadSlides` / `downloadResource` 是**下载**，
不是「改账号状态」。它归 source —— 数据源的职责是「取回数据」，落在本地磁盘
也是取回的一种。判据是**有没有副作用**，不是「有没有写文件」。
ASR（`trans audio`）要下模型、`live` 是长连接，同样归 source（都是取数据）。

### `packages/tool/*`（写操作，全部注册成 AI tool）

| # | 目录 | 包名 | 收什么 | 审批 |
| --- | --- | --- | --- | --- |
| T-1 | `campus-write/` | `dsh-zju-tool-campus-write` | **7 个模块的写操作**（见下表） | 每个动作一次 `askToWrite` |
| T-2 | `mail/` | `dsh-zju-tool-mail` | 发信 | 走审批 |
| T-3 | `zju/` | `dsh-zju-tool-zju` | 校园命令总入口 | 带 `--confirm` 的走审批 |
| T-4 | `campus/` | `dsh-zju-tool-campus` | `campus_profile` / `campus_note` / `campus_schedule` / `campus_context` / `campus_notify` | 读为主，无写 |
| T-5 | `wechat/` | `dsh-zju-tool-wechat` | `campus_wechat` | 无 |
| T-6 | `chat/` | `dsh-zju-tool-chat` | `campus_wechat_chat` / `campus_dingtalk` | 无 |

### T-1 收的写操作全集（21 条）

| 模块 | 写操作 | 来源 |
| --- | --- | --- |
| `zdbk` | `selection select` / `selection reorder` / `selection drop` | `module.json` |
| `sztz` | `activity signup` / `activity favorite` | 同上 |
| `tyys` | `venue book` / `venue order cancel` | 同上 |
| `xuezai` | `homework submit` / `homework retract` / `rollcall`（签到） | 同上 |
| `pta` | `problem save` / `problem submit` / `homework start` / `homework finish` | 同上 |
| `lab` | `select`（选实验，含 `--cancel` 退选） | 同上 |
| `cc98` | `board post` / `topic reply` / `floor like` / `floor rate` / `floor edit` / `private-message send` / `account signin` | 同上 |

**共 7 个模块 21 条**。

### 归属判据（写死的三条）

| 判据 | 归 source | 归 tool |
| --- | --- | --- |
| 会改账号状态（选课、报名、预约、交作业、签到、发帖、发信） | | ✅ |
| 只读，但落盘（下载课件、存 PDF、转写音频） | ✅ | |
| 只读，纯查询 | ✅ | |

**「落盘」不算写操作** —— 它没有副作用到外部系统。判据是**有没有改别人的状态**。

---

## 三、为什么要拆而不是「一个包内部署两半」

三个具体理由，都不是洁癖：

### 1. 依赖方向会冲突

`source/*` 的 `peerDependencies` 现在只有 `cordis`（+ 个别 `dsh-atomic-write`）。
写操作需要 `ctx.approval` 与 `ctx.tools`（`@deepseek-ai/dsh-tools`）。
把两者塞进一个包 = 让每一个只读数据源都声明「我能审批写操作」，
而它根本不需要。

### 2. 生命周期不同（这是硬约束）

审批**必须在已开启的 turn 内**调用（`user-approval/src/index.ts:244-250`）。
而数据源包会被后台任务调用：`feed.start()`、`watch.start()`、`learnKit.prepare()`
这些都不在 turn 里。

**所以同一个包里，「读」可以被后台调，而「写」不能。**
把两者放一起，等于让调用方每次都要想「我现在能不能用这个包的这一半」。
拆开后：`source/*` 随便调，`tool/*` 只能在 agent turn 里被模型调用。

### 3. 可审计性

拆开之后有一条能用 grep 验证的性质：

```
packages/source/**  不含 ctx.tools.register
packages/tool/**    不含外部 HTTP（fetch/axios/undici）
```

这两条都可以写成测试。混装状态下写不出这样的断言 ——
「这个包会不会改我的账号」只能靠人读 923 行才知道。

---

## 四、`campus` 的退役路径因此更清楚

原计划：`campus` 拆成 `source/xuezai` + `source/pta`（D8）。
现在按 D17 再拆一层：

```
source/campus（退役）
├─ 读 → source/xuezai + source/pta
└─ 写 → tool/campus-write
```

`campus` 现在**没有写操作**（PTA 提交与学在提交都还没实现），所以退役时
`tool/campus-write` 是**新建**而不是拆出来的。

---

## 五、对既有计划的修正

| 原条目 | 修正 |
| --- | --- |
| S-01 zdbk「扩展」含选课 9 条 | **改**：zdbk 只加读的 6 条（培养方案 2、学籍 1、选课查询 3）；写 3 条进 `tool/campus-write` |
| S-03 xuezai 含提交/撤回/点名 | **改**：source 只收列表与记录；提交/撤回/签到进 `tool/campus-write` |
| S-04 pta 含提交 | **改**：source 只收查询；提交 4 条进 `tool/campus-write` |
| S-08 sztz 含报名 | **改**：source 只收活动/记点/公告；报名/收藏进 `tool/campus-write` |
| S-09 tyys 含预约 | **改**：source 只收空场/须知/订单/考勤；预约/取消进 `tool/campus-write` |
| S-10 cc98「扩展」含写 7 条 | **改**：source 加 11 条读；写 7 条进 `tool/campus-write` |
| S-14 lab 含 select | **改**：source 收 8 条读；`select` 进 `tool/campus-write` |
| S-15 邮箱拆 4 包 | **不变**，但明确：`source/mail` 只做收信/读信/草稿；发信在 `tool/mail` |
| Q-D 学习页聚合 | **移出数据源范围**（用户裁决：不是纯数据源问题） |

---

## 六、包总数

| 类别 | 数量 |
| --- | --- |
| `packages/source/` 新建 | 14 |
| `packages/source/` 扩展 | 4 |
| `packages/source/` 退役 | 1（`campus`） |
| `packages/tool/` 新建 | 6（`campus-write` / `mail` / `zju` / `campus` / `wechat` / `chat`） |

**数据源 14 个纯只读包，写操作集中到 1 个 tool 包（`campus-write`）+ 1 个（`tool/mail`）。**
