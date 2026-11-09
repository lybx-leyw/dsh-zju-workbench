# dsh-radar-pet-overlay —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-11-10 · r165 · A 组（DSH 插件生态）** 自动生成，仅用于人工评审。
> `src/index.js` 的 `apply()` 只打一行日志；`src/upstream.js` 的两个函数**直接抛错**；
> 没有 UI、没有素材、没有 slot 注册。**请勿**加入任何 profile，**请勿**在真实环境挂载。
> 评审驳回则整目录删除。

---

## 一句话

**规划页右下角已经有角色了，但它没有表情。** 本包只给它补一套「在想 / 在写 / 等确认 / 出错」的状态动画，
**不新增角色、不新增面板、不装全局覆盖层**。

## 定性：**强化式集成**（不是「全新」）

| 判据 | 状态 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 渲染面是 `packages/client/page-planning/src/client.jsx` 里**已有的** `PlanningPet`（第 2504 行起的 `/* pet：右下角的对话角色 */` 段）；不注册 `shell.overlay`、不加导航 |
| ② 功能仍相似正交 | ✅ | 已有 pet 负责「说什么 / 要不要落库」；本包负责「它现在什么样子」。同一角色的两个正交维度 |
| ③ 底层多调了更优质实现 | ⚠ **带前提** | 上游有一张 8 列 × 9 行的现成帧表（`client.js` 的 `ROWS`）与 9 段气泡文案，比本仓现在的单一静态角色丰富；**但上游没有可 `npm install` 的实现**，所以「多调了一个更优质实现」目前只是「抄了一份更优质的数据」 |

> 判据③之所以打折：本仓其它 A 类骨架锁的是能在 npm 查到版本号的包。这个上游自陈
> 「以 DSH 动态插件形式开发并运行验证（`cordis_define`）」，装法是把两个字符串粘进工具里。
> **评审第一件事：确认 `dsh-kun-like-pet@1.0.0` 到底能不能装上。** 装不上就把
> `package.json` 的 `dependencies` 清空，改为只内联帧表常量。

## 它补了哪一格（读码实测）

| 位置 | 现状 |
| --- | --- |
| `page-planning/src/client.jsx:2504-2530` | `PlanningPet` 有气泡、有消息流、有「好」按钮才落库 —— **一个字符都不涉及表情/动画** |
| `page-planning/src/pet.js` / `pet-stream.js` / `pet-context.js` | 有完整的对话与流式链路，**没有状态枚举** |
| `grep -c "sprite\|animation\|帧" page-planning/src/client.jsx` | **1**（命中的还是注释） |
| 全仓 `sprite` / `spritesheet` / `avatar.*state` | 0 处 |

也就是说：**角色有了，角色的脸没有。**

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet) |
| 版本 | `1.0.0`（锁死；**无 npm 发布记录**） |
| 许可证 | **MIT** ✅（`LICENSE` 与 GitHub `spdx_id` 一致，`Copyright (c) 2026 liyupi`） |
| 星标 / 活跃 | ★113 · `pushed 2026-08-14`（约 3 个月无推送） |
| 形态 | DSH 动态插件（`src/host.js` + `src/client.js`，共 ~22 KB） |
| 素材 | `spritesheet.webp` **2079622 B** / `voice.mp3` 32539 B |

## 三条硬性裁剪（请评审逐条确认，这是本骨架的主要内容）

1. **不装 `shell.overlay`**。上游把桌宠挂在全局覆盖层上，任何页面都飘着。
   本仓规划页**已有**一个分区内的 pet —— 全局再飘一个是「重复且无增益」。
2. **不调系统命令放音**。上游 `host.js` 用 `child_process` 跑 `afplay` /
   `powershell SoundPlayer` / `ffplay`，入参是绝对路径的 mp3。本仓不引入这条通道：
   「会话完成必须响一声」的需求在 r130（通知层轴）已被判定**不成立**（待办到期时没有会话在跑），
   而跨平台系统命令 + 路径入参是明确的供应链风险面。
3. **不搬 2.0 MB 精灵图**。上游素材来自 Codex 桌宠契约，仓库里**只有代码是 MIT，
   素材归属未单独声明**。评审若要做，素材必须自备并写进 `ATTRIBUTION.md`。

## ⛔ 作废条件（先读这条）

- **评审结论是「一个静态角色已经够用」** → 整目录删除。这是完全允许的结局。
- **上游 `dsh-kun-like-pet@1.0.0` 装不上** → 本包只剩「一份帧表常量」，
  那么它不该占一个包位，应直接内联进 `page-planning`，**整目录删除**。
- **需要改 `page-planning` 的 `client.jsx` 才能接**（大概率如此）→ 那说明这不是一个
  独立插件，而是一次改版；评审应把它当改动评审，而不是当插件评审。

## TODO（评审通过后才允许动）

- [ ] 确认上游安装形态（npm / 动态插件字符串 / 只能 vendored）。
- [ ] 从 `pet.js` 的现有事件流派生 4 个状态（`idle` / `working` / `waiting` / `failed`），
      **不再造第二套事件源**；映射表见 `src/upstream.js` 的 `STATE_TO_ROW`。
- [ ] 素材自备 → `assets/`，来源写进 `ATTRIBUTION.md`。
- [ ] 只在本页右下角；不进 `docs/`、不进 `page-today`。

## 相关但**不属于**本包

- **性能条/波形**：学习页视频栏的语音色带已经是「有/无说话」的二元带
  （`core-playback` 的 `speechBands()`，依赖字幕），不是波形。补波形需要
  `AnalyserNode` 采样，且字幕要登录才拿得到 —— 那是**另一件**事，本轮只登记候选，不出骨架。
