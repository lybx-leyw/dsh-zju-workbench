# dsh-radar-api-drift —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-11-05 · 21 时 · A 组（DSH 插件生态）· 版本约束轴** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有路由、没有存储。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**「插件」页有依赖图，但图上的边是「包名」，不是「版本」。**

它按 `ctx.loader` / `ctx.registry` / `ctx.reflect` 与宿主 `/api/zhiyun-plugins` 拿到的模块边排拓扑序，
标出叶包 / 支撑包，另有一份账本记「用没用过」。它**不回答**：**宿主升了一版之后，这一排里谁的接口已经对不上。**

全 `packages/`（除 `packages/radar/`）**零处** `registry.npmjs.org` 查询、**零处** `peerDependencies` /
`engines` 求值（本轮 `grep` 实测）。一个插件声称 `cordis <5`、宿主已到 5，页面上看不出来：
它照样「已启用」，照样不挡任何人的路。

## 定性：**强化式集成**

| 判据 | 本包怎么满足 |
| --- | --- |
| ① 仍是同一个面板 | 上到 `zhiyun.plugins.content` 同一槽位，**不新增导航项** |
| ② 功能仍相似正交 | 现有答「依赖**包名**连坐」+「用没用过」；本条答「依赖**版本**是否还成立」 |
| ③ 底层多调了更优质实现 | ⚠ **待评审**，见下 |

判据 ③ 是本轮唯一没把握的一条：本包计算是纯函数，**不需要上游也能算**；上游 0.3.1 里虽有
「version compatibility」，但它**没有 npm 包**（404），且把五件事都做了。若评审判定 ③ 不成立 →
降为「重复且无增益」，**整目录删除**，把 `src/drift.js` 的形状内联进 `dsh-zhiyun-page-plugins`。

## 上游核验（2026-11-05 实测）

| 项 | 结果 |
| --- | --- |
| `GlariaLuminous/dsh-plugin-health-check` 许可证 | **MIT** ✅ |
| 首屏版本 | `0.3.1` |
| npm 可锁版 | ⛔ `registry.npmjs.org/dsh-plugin-health-check` → **404**（连试 5 次） |
| 挂载形状 | `dsh.bundle.patch` → **A 类** |

因为不可锁版，`dependencies` 为空，**一行上游代码都没摘**；`src/upstream.js` 只记录检查项清单。

## 文件

| 文件 | 作用 |
| --- | --- |
| `src/index.js` | 入口 + TODO-0～3（数据真源、默认关、联网触发方式、内联还是独立） |
| `src/drift.js` | `evaluate` / `foldRow` / `fetchLatest` 的**形状**（全部占位，返回 `unknown`） |
| `src/upstream.js` | 上游核验记录 + 检查项清单 |

## 评审重点

1. **TODO-0**：版本约束从哪读？宿主模块图**只有边没有版本**；真正的真源是每包 `package.json`，
   而 `/api/zhiyun-plugins` **已经在读这两份文件** → 优先复用它加字段，不要新开路由各做一半。
2. `unknown` 不能显示成 `ok` —— 读不到声明和「声明覆盖」是两件事。
3. 默认关；联网只在用户点击时发生。
