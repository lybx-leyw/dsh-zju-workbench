# dsh-radar-notify-push —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-11-03 · r133 · A/D 组** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志并返回一个状态对象；没有触发口径、没有节流、没有 UI、
> **没有发送实现**。**请勿**加入任何 profile。评审驳回则整目录删除。

---

## 一句话

给「今日」页的到期待办补一条**关掉标签页、手机也能收到**的送达通道 ——
锁版挂载 `@goodandready/dsh-plugin-notify@0.4.8` 的宿主半边，**只借送达，不改判定**。

## 集成类型：**强化式集成**（不是全新）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面、不新增设置分组、不改清单排序；推送只是「今日」页既有内容的**另一个出口** |
| ② 功能仍相似正交 | ✅ | 还是「今天要做什么、哪件过期了」；推送不参与判定，只负责送达 |
| ③ 底层多调了更优质实现 | ✅ | 原来**零送达**（不打开页面就永远看不见）；接入后是 Web Push + IM Webhook 双通道，**标签页全关仍可达** |

## 本仓现状（已核对源码，非推测）

- `packages/dsh-zhiyun-*/src` 下 `new Notification(` / `requestPermission` /
  `serviceWorker` / `setAppBadge` —— **真实调用 0 处**；
- `document.title` 仅 3 处，全是导出 PDF 时临时改标题；
- `apps/desktop` 是 Electron 打开 localhost，**无 SW / manifest / PWA 构建**；
- 到期判定已存在：`dsh-zhiyun-page-planning/src/time.js`（只算没做的）
  + `ticks.js`（「不需要再提醒了」的持久标记）。

⇒ 缺的不是「判定」，是「送出门」。

## 上游实测（2026-11-03，沙箱内真装真跑）

| 项 | 结果 |
| --- | --- |
| npm `latest` | **0.4.8**，与仓库 HEAD `package.json` 的 `version` **一致** |
| 安装 | `added 33 packages in 4s`，`node_modules` **12 MB** |
| 传递依赖 | `web-push@^3.6.7` ⇒ asn1.js / bn.js / http_ece / jwa … （VAPID 签名链，**非可选**） |
| `generateVAPIDKeys()` | 跑通（公钥 87 / 私钥 43 字符） |
| 客户端槽位 | 只注册 `plugins.item` / `plugins.row.config`（`lib/client.js:945,952`），**不接管** settings 分组 |
| Web Push 前提 | W3C Push API + Service Worker，**要求 HTTPS 或 localhost** |

## 与上一轮 `dsh-radar-zone-notify` 的关系（**评审第一题**）

`zone-notify`（r106）锁的 `dsh-plugin-notifications` **至今 npm 404** ⇒ 锁不住版、跑不起来。
本包换了一条上游，把它的阻塞点全部绕开：

| 能力 | zone-notify 的上游 | 本包的上游 0.4.8 |
| --- | --- | --- |
| 桌面/系统通知 | 宣称有 | 有（HTML5 Notification） |
| 关掉标签页仍可达 | 未证实 | **有**（Web Push + SW） |
| IM Webhook | 无 | 有（飞书/企微/钉钉/Slack/Discord/自定义） |
| npm 可锁版 | **否（404）** | **是（0.4.8）** |

**建议二选一，不要两个都接** —— 同时接 = 同一件事两套通知栈，用户会被弹两次。
若本包通过评审，`zone-notify` 应作废。

---

## 接入前必须先做的事

见 `src/index.js` 文件末尾的 TODO 1–10。三条最硬的：

1. **在 `zone-notify` 与本包之间二选一**（TODO 1）。
2. **拍板发送入口**：上游**没有对外发送面**（`tools.register` 零命中）。
   要么复用上游 VAPID + 订阅清单自写一行 `fetch`，要么老实挂上游只调它的
   `POST /dsh-plugin-notify/push/test`（语义是「测试」，不建议当通道）。
   判据不是代码长短，而是**VAPID 私钥归谁**（TODO 2）。
3. **在真实 profile 里核 peer 区间**：上游 peer 依赖
   `@deepseek-ai/{cordis,dsh-session,dsh-credentials,schemastery}`，
   本仓未把 `cordis` / `dsh-session` 版本钉在仓库里 ⇒ 装完才知道对不对（TODO 前条件）。

## 不要做的事

- **不要**把本包写进 `profiles/*/package.json` 的 `dsh.profile.bundles`；
- **不要**在本包内写测试（radar 包的硬边界，见任务文档）；
- **不要**搬运上游 `lib/index.js` / `lib/client.js` 的代码 —— 它们是编译产物，
  锁版挂载即可。

## 溯源

- 上游：`@goodandready/dsh-plugin-notify@0.4.8`，MIT，`https://github.com/GooDAnDReaDY/dsh-plugin-notify`
- 本轮报告：`docs/ecosystem-radar/2026-11-03-03.md`
- 登记表：`docs/ecosystem-radar/registry.md`
