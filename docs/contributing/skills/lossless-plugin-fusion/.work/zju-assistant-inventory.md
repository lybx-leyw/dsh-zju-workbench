# 融合整合清单（第 6 步定稿）

**定稿时间**：2026-11-09
**依据**：第 4 步用户裁决（18 数据源全接）+ 第 5 步泳道全留 + 三轮问答（审批包置顶层、本仓原生包、上游 WebVPN 口径）。
**用法**：第 7–9 步只围绕本表裁决，不再回头改图。

## 图例

- **类型**：`src` 数据源 / `proc` 变换链路 / `ui` 页面 / `tool` agent 触点
- **本项目现状**：必须有证据（包名 / 文件 / 测试名）；无证据写「未核实」
- **待办**：`扩展` 已有包加方法 / `新建` 建本仓原生包 / `裁决` 交用户定 / `无需` 已覆盖

---

## 一、拓扑最底层：新增审批基础设施包

用户裁决：「清单上在拓扑最低端加上审批插件包」。

| # | 泳道 | 保留节点（按顺序） | 类型 | 本项目现状 | 待办 |
| --- | --- | --- | --- | --- | --- |
| 0 | 全局 | 写操作 → 审批服务 → 放行/拒绝 | proc | **本仓零审批**：`packages/` 全树搜 `ctx.approval` / `approval.request` / `ZJU_ALLOW_WRITE` / `askToWrite`，**0 处命中**（唯一 `confirmed` 命中是 `source/zdbk/src/parse.js:299` 的选课状态字段，与审批无关） | **新建** |

**这个包必须回答的问题**（实现前仍需裁决，见第 9 步）：

1. **服务名与形态**：`ctx.approval`？还是本仓自己的 `ctx.zjuApproval`？上游用的是宿主 `ctx.approval`，若本仓宿主也有同名服务，直接借；若没有，得自建。
2. **tier 0 的依赖方向**：按 `packages/source/http/src/index.js:17` 的既有约定，tier 0「谁都能依赖它，它不依赖任何业务包」。
3. **审批交互落在哪**：上游在 dsh 上弹原生批准框。本仓若自建，弹窗由哪个页面承载（`client/page-*` 里哪个）？
4. **无审批渠道时的行为**：上游 `approval.mjs` 的口径是「没有审批渠道就抛错，绝不默认放行」。这条必须照抄 —— 默认放行等于没有闸。

**证据**：`packages/vendor/zju-assistant/plugin/host/approval.mjs`（59 行）是上游的完整实现，
含「权限模式是 never 时先说清楚用户没被问过」这一分支，可直接作为设计参照。

---

## 二、数据源层（18 个）

| # | 泳道 | 上游模块 | 本项目现状（有证据） | 待办 |
| --- | --- | --- | --- | --- |
| 1 | L1 | `zjuam` 统一身份认证 | `packages/source/login`（一卡通账号，`src/index.js` 33 KB）；`packages/source/http` 有 CAS 传输（`src/transport.js:33` AUTH_HOSTS 含 zjuam） | `无需` |
| 2 | L1 | `webvpn` 网关 | `packages/source/webvpn`（`src/protocol.js` 地址改写、`src/login.js` 网关登录、`src/egress.js` 344 行选路；判定只有 `CAMPUS_SUFFIX = 'zju.edu.cn'` 一个常量） | **独立集成计划 W1–W4**（见 [webvpn-plan](zju-assistant-webvpn-plan.md)）：后缀匹配 → 模块声明 + 68 主机实测表 + 会话内降级 |
| 3 | L2 | `zdbk` 教务网 | `packages/source/zdbk`，`src/index.js:93` 的 `READ_METHODS = ['grades','gpaSummary','exams','timetable']` | `扩展`：+`plan view/list`、`student`、`selection *`（读 6 个 + 写 3 个） |
| 4 | L2 | `yjsy` 研究生教务 | **无** | `新建` |
| 5 | L3 | `xuezai` 学在浙大 | `packages/source/campus`（待办 + PTA）；**课件/作业/点名不在本包** | `新建` 独立包 |
| 6 | L3 | `pta` 拼题A | `packages/source/campus`（`src/pta.js` 21 KB，只读题集） | `扩展`：+作业详情、提交、答案 |
| 7 | L3 | `lab` 实验选课 | **无** | `新建` |
| 8 | L4 | `zhiyun` 智云课堂 | `packages/source/classroom`（`src/index.js`，`src/source.js`） | `扩展`：+实时字幕、转写、FFmpeg 下载 |
| 9 | L4/L3 | `chaoxing` 学习通 | `packages/source/xxt`，`reads.js:438` 的 `XXT_METHODS` 9 个（含 schedule/notices） | `扩展`：+课件视频下载、章节清单 |
| 10 | L5 | `notice` 通知 | **无** | `新建`（含 68 主机表 + 两套适配器 webplus/kyjs） |
| 11 | L6 | `sztz` 二课 | **无** | `新建`（写：报名/取消） |
| 12 | L6 | `tyys` 场馆 | **无** | `新建`（写：预约/取消；含验证码识别） |
| 13 | L7 | `cc98` | `packages/source/cc98`，`src/index.js:86` 的 `METHODS` 10 个只读 | `扩展`：+写（发帖/回复/私信/签到）、+话题收藏下载 |
| 14 | L7 | `chalaoshi` 查老师 | **无** | `新建` |
| 15 | L7 | `ebook` 电子书 | **无** | `新建` |
| 16 | L7 | `cnki` 知网 | **无** | `新建`（含滑块验证） |
| 17 | L8 | 浙大邮箱 | **无** | `新建`（不在上游 core 模块表里，是 `plugin/host/mail.mjs`） |
| 18 | L9 | 微信公众号（weread） | **无** | `新建`（不在上游 core 模块表里，是 `core/weread`） |
| 19 | L10 | 微信聊天 | **无** | `新建`（`core/wechat`） |
| 20 | L10 | 钉钉聊天 | **无** | `新建`（`core/dingtalk`） |

> 注：编号 1–20 含 L1 的两个基础设施，实际「数据源」20 项对应上游 18 个 `core/zju/lib/*` 模块
> 加 4 个不在模块表里的（邮箱/公众号/微信/钉钉）减掉 webvpn+doc（doc 归 proc 层）。

---

## 三、proc 链路层

| # | 泳道 | 上游节点 | 本项目现状（有证据） | 待办 |
| --- | --- | --- | --- | --- |
| 21 | L2 | `schedule.mjs` 合表 + 校历排期 | 本仓无对应；`core/planning` 是规划域（`README.md` 两个入口） | `新建` |
| 22 | L2 | `holidays.mjs` 校历三层 | **无**（含 2025/2026 国家放假安排 + 浙大校历硬编码） | `新建` |
| 23 | L3 | `affairs.mjs` 作业聚合 | **无** | `新建` |
| 24 | L4 | `learning.mjs` / `xuezai.mjs` / `chaoxing.mjs` 学习页聚合 | `packages/core/learning-resource`（schema + 章节投影）；`core/study`（学习空间） | `裁决`：功能重叠，见第 8 步 |
| 25 | L5 | `feed.mjs` 通知汇总 | **无** | `新建` |
| 26 | L5 | `notice-filter.mjs` 相关度筛选 | **无** | `新建` |
| 27 | L11 | `doc` 文档处理 | `packages/core/parser`（三阶段，LLM）；`vendor/paper-reader`（PDF 阅读） | `裁决`：见第 8 步 B/C |
| 28 | L12 | `alerts.mjs` 提醒总线 | **无** | `新建` |
| 29 | L14 | `learn` 课程讲解引擎 | `core/classroom-generate`（四段管线）+ `classroom-media`（TTS/ASR/图/检索）+ `classroom-export`（PPTX/HTML/ZIP）+ `classroom-studio` | `裁决`：见第 8 步 B |
| 30 | L15 | `film.mjs` CSP 沙箱播放 | `core/classroom-export` 有单文件 HTML 导出 | `裁决` |
| 31 | L16 | `store.mjs` 档案库 | `core/vault`（Obsidian 式：双链/图谱/重命名改链）+ `client/page-notes` | `裁决`：本仓是超集，见第 8 步 C |
| 32 | L16 | `context.mjs` 校园档案 | **无**（`core/vault` 是通用笔记库，无 course/platform/matter 三种档案与关联核对） | `新建` |
| 33 | L13 | `campus-page.mjs` 带登录的浏览器 | **未核实**：本仓有无 CDP 或等价能力，我查不到证据 | `裁决` |

---

## 四、终端层：page / tool / preset / skill

### page（UI 展示链路）

| # | 页面 | 上游 | 本项目现状 | 待办 |
| --- | --- | --- | --- | --- |
| 34 | 日程表 | `client/SchedulePage.tsx`（40 KB） | `client/page-today`（日程、插空任务、最近进度） | `裁决`：并入 today 还是新开 |
| 35 | 校园事务（作业） | `client/AffairsPage.tsx`（22 KB） | **无** | `裁决` |
| 36 | 学习（智云/学在/超星） | `client/LearningPage.tsx`（32 KB）+ `LearningChaoxing` + `LearningXuezai` | `client/page-study`（课程树、讲义阅读、分层检索、习题） | `裁决`：明显重叠 |
| 37 | 校园通知 + 个人消息 | `client/Feed.tsx`（30 KB） | **无** | `裁决` |
| 38 | 个人档案设置 | `client/ProfileSettings.tsx` | `client/page-notes` 有笔记 UI，但无「基础信息」表单 | `裁决` |
| 39 | 备忘录 | `client/Memos.tsx` + `Notes.tsx` | `client/page-notes` | `裁决`：并入 notes |
| 40 | 各子插件配置页 | `AccountForm` / `MailSettings` / `ChatSettings` / `CourseSettings` / `LearnSettings` / `WechatSettings` / `NoticeFilterSettings` | `client/page-plugins`（插件页） | `裁决` |

### tool（agent 可调用的工具）

| # | 工具 | 上游 | 本项目现状 | 待办 |
| --- | --- | --- | --- | --- |
| 41 | `zju` 总入口 | `host/zju-tool.mjs`（101 行，跑 core 子进程） | **无**（本仓 `tool/study` 只有 `study_catalog/read/search`） | `新建` |
| 42 | `campus_profile` | `host/tools.mjs:51` | **无** | `新建` |
| 43 | `campus_note` | `host/tools.mjs:71` | **无** | `新建` |
| 44 | `campus_schedule` | `host/tools.mjs:89` | **无** | `新建` |
| 45 | `campus_context` | `host/tools.mjs:113` | **无** | `新建` |
| 46 | `campus_notify` | `host/tools.mjs:167` | **无** | `新建` |
| 47 | `campus_mail` / `campus_mail_send` | `host/rows/mail.mjs` | **无** | `新建` |
| 48 | `campus_wechat` | `host/rows/wechat.mjs:40` | **无** | `新建` |
| 49 | `campus_wechat_chat` / `campus_dingtalk` | `host/rows/chat.mjs:32` | **无** | `新建` |

**注入点约定**（本仓事实，已核实）：`packages/tool/study/src/index.js:53` 只做 `ctx.tools.register(tool)`，
**不带自己的挂载行**；`packages/preset/lecture/` 是唯一 preset。工具的可见范围由 preset 决定，不写进 profile bundles。

### preset

| # | 上游 | 本项目现状 | 待办 |
| --- | --- | --- | --- |
| 50 | 无 preset（上游 10 行是 bundle 子插件，不是 agent preset） | `packages/preset/lecture`（唯一，含 `study_catalog/read/search`） | `裁决`：见第 9 步 |

### skill

| # | 上游 | 本项目现状 | 待办 |
| --- | --- | --- | --- |
| 51 | `zju-campus`（`plugin/skill/SKILL.md` 5.4 KB + 3 篇 references + 9 篇 rows） | 本仓无同类校园技能；`docs/contributing/skills/` 有 2 个但与校园无关 | `裁决`：新增还是并入 |

---

## 汇总

| 类别 | 数量 |
| --- | --- |
| 新增 tier 0 基础设施包 | 1（审批） |
| 数据源：`新建` | 13 |
| 数据源：`扩展` | 5 |
| 数据源：`无需`（已覆盖） | 2 |
| proc：`新建` | 9 |
| proc：`裁决` | 5 |
| page：`裁决` | 7 |
| tool：`新建` | 9 |
| preset / skill：`裁决` | 2 |

**下一步**：第 7 步逐字段比对数据源（已有 5 个扩展点 + 13 个新建的鉴权/只读/WebVPN），
第 8 步给出 5 个 proc 裁决项的量化对比表，第 9 步走四类终端裁决。
