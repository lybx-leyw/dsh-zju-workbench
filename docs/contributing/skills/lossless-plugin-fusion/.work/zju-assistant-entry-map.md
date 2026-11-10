# zju-assistant 入口 → 泳道 映射表

第 2 步产物。**范围内的可执行入口全部列在下面，未映射项 = 0。**
入口来源三处：`core/zju/lib/cli.ts` 的 18 个模块注册表、`plugin/rows.mjs` 的 10 行、
`plugin/host/index.mjs` 的 dispatch 表 + `ctx.tools.register`、`plugin/client/index.tsx` 的插槽登记。

## 探索范围声明

| 已读 | 内容 |
| --- | --- |
| `LICENSE` / `package.json` / `THIRD_PARTY_NOTICES.md` / `PATCHES.md` / `README.md` | 协议、运行形态、我们的改动量 |
| `core/zju/lib/cli.ts` + 18 个模块的 `cli.ts` | 全部命令注册 |
| `core/zju/scripts/zju.ts` | 单一可执行入口与模块禁用闸 |
| `core/zju/lib/profile/profile.ts` / `core/paths.ts` | 凭据与目录约定 |
| `plugin/package.json` / `rows.mjs` / `bundle/cordis.patch.yml` / `bundle/package.json` | 插件身份、10 行、组合包 patch |
| `plugin/host/index.mjs` | 根服务、dispatch 全表、插槽 |
| `plugin/host/tools.mjs` / `zju-tool.mjs` / `rows/*.mjs` | 9 个工具 + 分行登记 |
| `plugin/host/*.mjs`（30 个）文件头 | 各模块职责 |
| `plugin/client/index.tsx` | 侧栏三页、设置分区、行配置插槽 |
| `plugin/skill/SKILL.md` + `skill/rows/*.md` | 技能正文与按行拼接 |

**未探索（明确列出）**：

- `core/chat`、`core/skills`、`core/initialize`：`core/chat` 无代码（仅 `.test.mjs`，属上游测试）、
  `core/skills` 是 5 个 skill 的 md 模板、`core/initialize` 只有 `references/`。
  三者**不产生运行期数据流**，但**也没有逐文件读完** —— 若它们含可执行入口，本表会漏。
- `plugin/locale/*.json`、`plugin/rows/*/locale/*.json`：纯文案，无入口。
- `plugin/client/*.tsx` 的组件内部（除 `index.tsx`）：逐个组件的按钮未枚举，
  统一按「挂在该行的页面插槽下」计入对应泳道。
- 上游 `core/learn/engine/**`（含 `vendor/`）：只读了 `plugin/host/learn.mjs` 的调用面，
  引擎内部的渲染细节未读。

## 一、`core/zju` 命令入口（18 模块）

| 入口 | 位置 | 落到泳道 | 状态 | 写闸 |
| --- | --- | --- | --- | --- |
| `profile show` | `lib/profile/cli.ts:9` | L1 | 已画 | — |
| `webvpn check/doctor/session/url/intercept` | `lib/webvpn/cli.ts` | L1 | 已画 | — |
| `zjuam login/logout/status` | `lib/zjuam/cli.ts` | L1 | 已画 | — |
| `zdbk timetable` | `lib/zdbk/cli.ts:22` | L2 | 已画 | — |
| `zdbk exams` | `lib/zdbk/cli.ts:27` | L2 | 已画 | — |
| `zdbk grades` | `lib/zdbk/cli.ts:31` | L2 | 已画 | — |
| `zdbk student` | `lib/zdbk/cli.ts:33` | L16（→ 基础信息） | 已画 | — |
| `zdbk plan view/list` | `lib/zdbk/cli.ts:35` | **未映射** | 培养方案，无对应泳道 —— 见下「遗漏处理」 | — |
| `zdbk selection context/selected` | `lib/zdbk/selection-cli.ts` | L6（选课读） | 已画 | — |
| `zdbk selection select/drop/withdraw` | `lib/zdbk/selection-cli.ts:86,101` | L6 | 已画 | **写**（journal + confirm） |
| `zdbk login/status/logout` | `lib/zdbk/cli.ts:42` | L1 | 已画 | — |
| `yjsy timetable` | `lib/yjsy/cli.ts:6` | L2 | 已画 | — |
| `notice list/view/new/sources` | `lib/notice/cli.ts` | L5 | 已画 | — |
| `sztz activity list/new/mine/signup` | `lib/sztz/cli.ts:19` | L6 | 已画 | signup 写 |
| `sztz project/bulletin/credits` | `lib/sztz/cli.ts` | L6 | 已画 | — |
| `ebook search` | `lib/ebook/cli.ts:8` | L7 | 已画 | — |
| `lab ...`（选实验 / 退 / 登录 / 状态） | `lib/lab/cli.ts` | L3（实验课） | 已画 | 选/退 写 |
| `xuezai course/list/materials/activity` | `lib/xuezai/cli.ts` | L4 | 已画 | — |
| `xuezai homework list/get` | `lib/xuezai/cli.ts` | L3 | 已画 | — |
| `xuezai homework submit/retract` | `lib/xuezai/cli.ts` | L3 | 已画 | **写** |
| `xuezai todos` | `lib/xuezai/cli.ts` | L3 | 已画 | — |
| `xuezai rollcall*`（点名） | `lib/xuezai/rollcall-cli.ts` | L3 | 已画 | 签到写 |
| `zhiyun courses/check/trans/slides/...` | `lib/zhiyun/cli.ts` | L4 | 已画 | — |
| `zhiyun download/record/live` | `lib/zhiyun/cli.ts` | L4 | 已画 | — |
| `tyys venue list/book/cancel/orders/rules` | `lib/tyys/cli.ts:18` | L6 | 已画 | book/cancel 写 |
| `tyys attendance history` | `lib/tyys/cli.ts` | L6 | 已画 | — |
| `tyys session *` | `lib/tyys/cli.ts` | L1（会话） | 已画 | — |
| `pta homework list/...` | `lib/pta/cli.ts` | L3 | 已画 | — |
| `pta write/answers/finish` | `lib/pta/write.ts` | L3 | 已画 | **写** |
| `chaoxing course/files/download` | `lib/chaoxing/cli.ts` | L4 | 已画 | — |
| `chaoxing homework` | `lib/chaoxing/cli.ts` | L3 | 已画 | — |
| `cc98 search/topic/hot/new */boards/user` | `lib/cc98/cli.ts` | L7 | 已画 | — |
| `cc98 account notifications/conversations/messages` | `lib/cc98/cli.ts` | L7 | 已画 | — |
| `cc98 post/reply/message/signin` | `lib/cc98/cli.ts` | L7 | 已画 | **写** |
| `chalaoshi search/rate` | `lib/chalaoshi/cli.ts` | L7 | 已画 | — |
| `cnki search/download` | `lib/cnki/cli.ts` | L7 | 已画 | — |
| `doc text/pdf/pages/find/images/render` | `lib/doc/cli.ts` | L11 | 已画 | — |
| `net check/clear-cache`（hidden，`retired`） | `lib/cli.ts:44` | — | **已废弃** | — |

## 二、`plugin/host` 路由与工具入口

| 入口 | 位置 | 落到泳道 | 状态 |
| --- | --- | --- | --- |
| `POST /api/zju-campus`（dispatch 全表，约 60 个 action） | `host/index.mjs:135` | L1–L18（按 action 前缀分派） | 已画 |
| `GET /api/zju-campus/film` | `host/index.mjs:140` | L15 | 已画 |
| tool `zju` | `host/zju-tool.mjs:59` | L2/L3/L4/L5/L6/L7/L11 | 已画 |
| tool `campus_profile` | `host/tools.mjs:51` | L16 | 已画 |
| tool `campus_note` | `host/tools.mjs:71` | L16 | 已画 |
| tool `campus_schedule` | `host/tools.mjs:89` | L2 | 已画 |
| tool `campus_context` | `host/tools.mjs:113` | L16 | 已画 |
| tool `campus_notify` | `host/tools.mjs:167` | L12 | 已画 |
| tool `campus_mail` | `host/rows/mail.mjs:13` | L8 | 已画 |
| tool `campus_mail_send` | `host/rows/mail.mjs` | L8 | 已画（写） |
| tool `campus_wechat` | `host/rows/wechat.mjs:40` | L9 | 已画 |
| tool `campus_wechat_chat` | `host/rows/chat.mjs:32` | L10 | 已画 |
| tool `campus_dingtalk` | `host/rows/chat.mjs:32` | L10 | 已画 |
| skill provider `zju-campus` | `host/index.mjs:147` | L17 | 已画 |
| 后台定时：`feed.start()` | `host/index.mjs:126` | L12 | 已画 |
| 后台定时：`wechat.start()` | `host/rows/wechat.mjs:38` | L9 | 已画 |
| 后台定时：`watch.start()`（两个聊天） | `host/rows/chat.mjs:49` | L10 | 已画 |
| 后台定时：`learnKit.prepare()` | `host/rows/learn.mjs` | L14 | 已画 |
| 管道监听：`startModelBridge` | `host/index.mjs:90` | L6（验证码） | 已画 |
| 管道监听：`WereadBridge.listen`（PTA） | `host/index.mjs:96` | L3（PTA 滑块） | 已画 |
| 管道监听：`WereadBridge.listen`（公众号） | `host/rows/wechat.mjs:24` | L9 | 已画 |
| 行启停 `ctx.zjuCampus.activate(key)` | `host/row.mjs:11` | L18 | 已画 |

## 三、`plugin/client` 界面入口

| 入口 | 位置 | 落到泳道 | 状态 |
| --- | --- | --- | --- |
| 侧栏「日程表」 | `client/index.tsx:60` | L2 | 已画 |
| 侧栏「校园事务」 | `client/index.tsx:61` | L3/L5/L8/L12 | 已画 |
| 侧栏「学习」 | `client/index.tsx:62` | L4/L14 | 已画 |
| 设置「个人档案」 | `client/index.tsx:165` | L16 | 已画 |
| 10 行的配置页插槽 | `client/index.tsx:177` | L18 | 已画 |
| 组合包启用引导 | `client/index.tsx:182` | L18 | 已画 |

## 四、遗漏处理

### `zdbk plan view/list`（培养方案）—— 未映射，理由与影响

- **不是遗漏，是画图时没单列**：培养方案读取（`lib/zdbk/pyfagl.ts`）在当前流程里只被
  `packages/vendor/zju-assistant` 的 CLI 与 `campus_context.initialize` 间接使用，
  **没有独立的页面终端**，也不产出被其它泳道消费的数据。
- 按硬规则 2 记在这里：**如果融合时把 zdbk 数据源换成本仓 `packages/source/zdbk`，
  这条命令会失去实现** —— 本仓 `zdbk` 只有 `grades` / `gpaSummary` / `exams` / `timetable` 四个方法，
  没有培养方案。影响：`campus_context.initialize` 建档时拿不到培养方案，档案里的「核心课」一类字段会缺。
- 处理建议：第 7 步比对 `packages/source/zdbk` 时，把「是否需要扩展培养方案接口」列成明确问题问用户。

### `zdbk student`（学籍）—— 已映射但同样依赖扩展

归到 L16（基础信息自动填写，`identity-fill.mjs` 用它读姓名/学院/专业）。
本仓 `packages/source/zdbk` 同样没有 `student` 方法，融合时需一并裁决。
