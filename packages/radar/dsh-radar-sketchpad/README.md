# dsh-radar-sketchpad —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-11-02 · r131 · A 组（DSH 插件生态）** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有路由、没有存储。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**课堂页能「按脚本画」，但不能「人补一笔」。** 舞台的 `SHAPE_PATHS` 只有
`rectangle / circle / triangle` 三个形状，路径写死；人手画的线只能当图片贴进来，
不参与 DSL。本包把 `dsh-sketchpad` 的手写画板**锁版挂进课堂页**：
**舞台还是那个舞台，新增的是「人直接画」这条通道，和 5 个形状。**

## 定性：**强化式集成**（不是「全新」）

| 判据 | 本包怎么满足 |
| --- | --- |
| ① 仍是同一个面板 | 不新增导航项、不新增页面；画布落在课堂页已有舞台里。**代价**：必须关掉上游自带的「右侧栏竖版画板」，否则等于多出一个页面 |
| ② 功能仍相似正交 | 现有是「DSL 动作 → 形状」，本包是「人 → 笔画」。都在课堂页上画，一个脚本驱动、一个人驱动，互不替代 |
| ③ 底层多调了更优质实现 | **部分成立，评审必须重判** —— 手感层（Palm rejection 自学习、40 步撤销、0°/45° 吸附、双指轻点撤销）与「画完落成附件」链路是真增量；**但形状扩充那部分不借用上游代码**，要把 `SHAPE_PATHS` 从 3 个扩到 8 个，仍得本仓自己写路径并过 `validateShapeGeometry` |

## 本仓现状（把「缺口」量出来）

| 位置 | 现有 | 缺口 |
| --- | --- | --- |
| `dsh-zhiyun-core-classroom-stage/src/geometry.js` | `SHAPE_PATHS` = `rectangle` / `circle` / `triangle`，viewBox 1000×1000 | 讲流程 / 判定 / 关系时没有 `line` / `arrow` / `diamond` / `text` / `ellipse`；白名单外名字**刻意不许**退化成矩形 |
| 同上 | `wb_draw_shape` 由 DSL 给出，几何走 `dsh-zhiyun-classroom-geometry` | **没有人手直接画的通道** |
| `packages/dsh-zhiyun-*/src` 全量 grep | `createDrafts` **0** · `conversation.input.left/right` **0** · `sidebar.right.pane.tab` **0** · `commandUi` **0** | 上游三个入口本仓一个都没占 ⇒ **不抢槽位** |

## 上游事实（2026-11-02 实核：npm tarball + GitHub 文件树，不采信 README 单方说法）

| 项 | 值 |
| --- | --- |
| 包 | `dsh-sketchpad@0.1.1` · MIT · ★2 · 2026-11-01 仍在推 |
| 锁版可行性 | `dependencies` 空、无 `prepare`、peer 只有宿主 `@deepseek-ai/cordis ^4.0.0` ⇒ **可锁版** |
| 形态 | **纯客户端插件**：`lib/index.js` 12 行、`apply()` 为空、**无 `ctx.provide`**；`dsh.client.platform = "web"` |
| 占用 | 1 个服务 `commandUi` + 3 个槽位 `conversation.input.left` / `.right` / `sidebar.right.pane.tab` |
| 塞图方式 | 宿主 `conversation` 服务的 `createDrafts(...)`；笔画级字段 `points / kind / width / color` |
| 数据 | 不联网、不读消息内容；只碰草稿附件 API、会话输入状态、右侧栏 API、`localStorage`；PNG 在浏览器里生成 |
| 上游自陈限制 | 无压感；两画板内容独立；尺寸固定（1600×1000 / 1000×1333）；刷新清空 |

## 评审必须先回答的三件事

1. **舞台是不是 iframe？** 若是（同 `dsh-zhiyun-page-paper` 的承载方式），上游的 `conversation.input.*`
   槽位进不了 iframe 内部 → 本骨架形态要整体改成「外层浮层」，而不是「舞台内画布」。
2. **宿主版本对得上吗？** 本仓 `0.2.0-rc.2`，上游 README 只承诺 `0.2.1-rc.2+`
   → 必须真机跑一次 `ctx.get("conversation").createDrafts` 是否存在。不存在则**降级为不挂 bundle**，
   只借手势参数与形状清单。
3. **坐标系会不会画歪？** 上游 1600×1000 / 1000×1333，舞台 1000×1000 且 `viewportRatio` 是 **高/宽**
   → 落库前必须归一，否则线会偏。

## 目录

```
package.json     # dependencies 锁 dsh-sketchpad@0.1.1（写死，不用 ^）
cordis.patch.yml # 只 insert 本包；**不**搬上游那条 patch
src/index.js     # 占位 + TODO，apply() 只打日志
src/upstream.js  # 上游事实清单 + 兼容层 TODO（不摘上游代码）
OWNERS           # Owner: shared
```

## 为什么不搬上游的 `cordis.patch.yml`

上游那条是 `insert: [{ id: dsh-sketchpad, name: dsh-sketchpad }]`，装上后输入框 `+` 菜单与右侧栏
各多一个画板。本仓要的是「课堂页里画一段」，两处同时挂 = 输入框多两个抢同一槽位的按钮
（同 `dsh-prompt-market` 与 `dsh-prompt` 那次二选一的教训）。

## 许可证

上游 MIT ✅（宽松白名单内）。本包不摘上游源码，只锁版引入 + 外围兼容层。
