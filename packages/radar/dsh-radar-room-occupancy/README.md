# dsh-radar-room-occupancy —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` / `roomState()` 与 `src/upstream.js` 的
> `isClosed()` / `roomStatus()` 都直接抛错。
> **请勿**把它加入任何 profile（`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`），
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

给定「某间教室 · 某时刻」，答出**四态之一**：可用 / 占用 / 课间切换（<10 分钟）/ 受限，
并先生成一道**校历闭馆**闸门（运营时段 → 节假日 → 特殊事件）。

## 关系判定：**强化式集成**（不是全新）

| 判据 | 本候选 | 依据 |
| --- | --- | --- |
| 仍是同一个面板？ | ✅ | 不新增导航项 / 槽位 / 路由。只给课表面板加一个「教室」维度 |
| 功能仍相似正交？ | ✅ | 仍是「这周这节在哪上课、这间现在能不能用」，不改做食堂菜单、不做校园地图 |
| 底层多调了更优质实现？ | ✅ | 本仓**没有任何**「教室占用」判定；上游把「课间 10 分钟」「受限空间」「闭馆三段闸」都做出来了，本仓是零 |

## 类型：**B 类（其他 JS 项目）**，不是 A 类

上游 `Aula-Finder` 是 **Next.js 16 + TypeScript 的网页应用**，
`package.json` 中 `"private"` / 未发布 npm → **无法锁版**，也**没有** `dsh.bundle.patch`。
因此只能做「能力提取」，`dependencies` 为空。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [Open-Source-Uniandes/Aula-Finder](https://github.com/Open-Source-Uniandes/Aula-Finder) |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`，根目录有 `LICENSE`） |
| Stars | ★11（fork 少；2026-08-31 最后 push） |
| 语言 | TypeScript（Next.js 16 / React 19 / Vitest） |
| 数据源 | 安第斯大学**公开**课程 API（`ofertadecursos.uniandes.edu.co`），GH Actions 每学期拉一次 |
| 形态 | **不是 DSH 插件**，是独立 Web App → 只能「能力提取」 |

### 取什么 / 不取什么

| 取 | 文件 | 理由 |
| --- | --- | --- |
| ✅ 四态判定 | `lib/query-utils.ts` | 课间 10 分钟 + 受限空间是**本仓完全没有**的判别力 |
| ✅ 闭馆三段闸 | `lib/closures.ts` | 运营时段 → 节假日 → 事件，顺序有语义（决定归因 reason） |
| ✅ 课程段解析 | `lib/parse-courses.ts` | 一节课 → (楼栋, 教室, 星期, 起止) 的通用剖分 |
| ⛔ 不取 | Next.js 页面 / URL 状态 hook / GH Actions 管道 | 上游的学期抓取管道绑定的是安第斯大学的 API，浙大无对应公开接口 |
| ⛔ 不取 | 上游的 `data/*.json` 快照 | **那是他校数据**，与本仓无关，且属于内容版权 |

## 前置（评审第一件事）

> **先证明数据空洞是真的**：`zdbk` 课表接口是否带**教室**与**楼栋**字段？

- **有** → 本地即可合成占用表，本包只剩「纯计算」，范围清晰。
- **没有** → 只能由用户导入的 `.ics` / 课表快照在**本地**合成；此时必须同步确认
  「合成表不出本地、不上传」，否则本包**立即判 ⛔ 删除**。

这一条与 `../dsh-radar-tongge-schedule/README.md` 第 62 行的待办**是同一项**，
两者应当一起评审，不要各做一遍。

## 为什么不是「重复且无增益」

本仓现有 `dsh-radar-tongge-schedule`（撞课 + 楼栋距离）回答的是
「**我这节课**和别人的课会不会撞、走不走得过去」；
本候选回答的是「**这间教室此刻**能不能进去」。前者是**我的日程视角**，
后者是**空间资源视角** —— 相似处只在「都用到楼栋表」，正交处在判定对象不同。
