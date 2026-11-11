# 数据源审核结果 · source/chalaoshi

**审核代理**：`733626fb`
**结论**：打分与查询拆分是**上游的忠实移植**（10 档逐档一致），但一个关键公式被改坏，且 `index.js` 158 行状态机**零测试**。

---

## 阻断级（2 条）

| # | 问题 | 位置 | 后果 |
| --- | --- | --- | --- |
| **B1** | `timeoutMs: 30000` **不是任何一层的有效选项**，且无失败退避 | `chalaoshi.js:293` → `index.js:36-39` → `http/src/index.js:64-72` → `egress.js:275-279` | 全程原样透传，**无处读它**（唯一读 `timeoutMs` 的是 `Transport`，本包没用）。更糟：缓存过期后**每次 search 都重走一遍失败刷新**，可**无界阻塞** |
| **B2** | 缓存**非原子写** + 每次降级都**全量重写 1 MB** | `index.js:60`、`:69` | ① 直接 `writeFile`（本仓有 `dsh-atomic-write`，4 处在用）；② `index.js:68` 注释「只有真的变了才写盘」是**假的** —— 无条件 `cache.write`；③ 截断后 `catch{}` 当作没缓存 → 下次直接 `UNREACHABLE`；④ **无 `mkdir`**，目录不存在会让一次**成功的**检索以 ENOENT 失败 |

### B1 的机制（代理还原的调用链）

```
chalaoshi.js:293  request(url, { headers, timeoutMs: 30000 })
  → index.js:36-39  requestOf: (url, init) => sharedFetch(ctx)(url, init)   // 原样传
  → http/src/index.js:64-72  sharedFetch → egress.fetch
  → egress.js:275-279  只读 init 的 method/signal，不读 timeoutMs
```

上游用 `requireReachable` **按主机缓存通断 10 分钟**（`core/reach.ts:14` + `chalaoshi/index.ts:39-44`），**这一整层在本仓丢失**。

## 重要（10 条）

| # | 问题 | 位置 | 后果 |
| --- | --- | --- | --- |
| **M1** | **hot 加成公式改坏**：本仓 `Math.min(3, hot/10)`，上游 `(hot/maxHot)*3` | `chalaoshi.js:200` vs `index.ts:247,267` | `hot >= 30` **一律封顶 3 分** → 人气差异被抹平。**夹具的 90/40 两位都 ≥30，两种公式下差距被完全遮住** |
| M2 | `college` 过滤在 `limit` **截断之后** | `index.js:103-111` | 结果偏少甚至为空，`count` 失真 |
| M3 | 显式 `college` 与 token 学院是 **AND**（上游是「显式覆盖」），且只做 `name.includes`（上游接受 id） | 同 | 语义偏差 |
| M4 | `module.json` 第 3 条能力 `chalaoshi course` **完全不存在**，但 description 与 README 都声称「课程绩点」 | `package.json:4`、`README:3` | 虚假声明 |
| **M5** | 「只返回原始 HTML」判定为**功能缺失**，不是 D17 简化 | `chalaoshi.js` | 依据：本仓 `xxt`/`zdbk`/`campus` 都有 parse；`source-error-contract.test.mjs:1-17` 明写「数据源自己封装，下游直接调用」。上游三个解析器共约 70 行 |
| **M6** | `src/index.js` **零测试** | `tests/chalaoshi.test.mjs:14-16` | 只 import 了 `chalaoshi.js`。`ensureIndex` 写成 `apply` 内闭包，比上游的导出纯函数更难测 |
| M7 | 未装进 profile | `profiles/zju-workbench/package.json` | 服务与路由在产品里根本不存在 |
| M8 | 上游稳健性三件套全丢：400ms 限流、2 次重试（0.8/1.6s）、404 与 5xx 区分 | `index.ts:375-411` | 上游理由原话：「站点在海外、链路不稳」 |
| M9 | `fetchTeacherPage` 无 try/catch；`id` 未校验 | `chalaoshi.js:357-361` | 网络失败落到路由的 `FAILED`，用户在「国内打不开教师页」这个**最常见**场景拿不到「需要出海」的提示 |
| M10 | 测试弱断言三例 | `test:91-94`、`:144-149` | ① `ratedOnly` 是**真空真**（空数组上 `every` 也过，删掉过滤逻辑仍绿）；② 「缓存新鲜期内不联网」只断言 `fresh()` 谓词，**从不经过真正决定不联网的 `index.js:66`**；③ 夹具 hot 值掩盖 M1 |

## 次要（10 条，摘要）

N1 路由恒 200、无回环校验、不校验方法
N2 `catch{}` 把 EACCES 也当「没缓存」且不记日志
N3 **304 也全量写盘** —— README:67-68 的「304 不重写 1 MB」**在集成层是错的**
N4 `sync` 两条「用缓存」路径形状不一，`source:'cache'` 同时表示「新鲜」与「降级」，`degraded` 是自由文本非布尔 → **会误导**
N5 学院解析失败给 `''`（上游给 `学院${xy}` 兜底）
N6 死代码、按学院浏览时 `match:'name'` 是错标签
N7 `score` 缺 hot 第三键、`name` 缺 score 次键
N8 `limit` 无校验（-1/NaN）
N9 测试注释与代码脱节
N10 `read()` 不校验 `fetchedAt` → 老缓存永远「不新鲜」→ 每次联网

---

## 上游对账要点（28 项导出，无第三态）

| 类别 | 项 |
| --- | --- |
| ✅ **逐字一致** | `SITE`、`parseRate`、`splitQuery`、`norm`、`isSubsequence`、`scoreToken`（10 档全对） |
| ⚠️ 有改动 | `searchIndex`（hot 加成 + 排序次键缺失） |
| ❌ **丢弃且属功能缺失** | `parseTeacherPage`、`parseComments`、`parseGpaTable` + 4 个 interface、`Chalaoshi.comments`、`Chalaoshi.courseGpa` |
| ❌ 丢弃**正确** | `cli.ts`（D17 禁接口层） |
| 死导出 | `API` 常量全仓零引用 |

**module.json 3 条能力**：search ✅ 完整；teacher ⚠️ 只到原始 HTML；course ❌ **不存在**。

**上游实测事实的去留**：
- **保留**：「无搜索接口 / 1 MB / 浏览器内过滤」、「2026-09-17 被墙 + WebVPN 帮不上忙」（还**追加了 2026-11-10 本机复测**，比上游更强）
- **失效**：「索引 1.7–3.0s / 教师页 0.5–1.8s / 评论 0.7–1.2s / gpa 1.2s」**一处都没保留** —— 而这些数本来是定超时用的，**正对应 B1**
- **丢失**：「10295」精确数字降级为「一万多位」、「读+解析 6ms / 线性扫 0.15ms」、「10 分钟通断缓存」

---

## 「改坏分档能不能被抓」试算（代理逐个试过）

| 改动 | 能否抓到 |
| --- | --- |
| `100 → 70` | ✅ 红灯 |
| `90 → 45` | ✅ 红灯 |
| `80 → 60` | ❌ **抓不住** |
| `60 → 30` | ❌ **抓不住** |
| `70 → 40` | ❌ 抓不住 |
| `55/45` 阈值 | ❌ 抓不住 |
| **整个删掉 30 子序列档** | ❌ 抓不住 |
| 加成公式任意改 | ❌ 抓不住 |
| `rate` 的 `?? -1` | ❌ 抓不住 |
| score 排序次键 | ❌ 抓不住 |

**根因**：`scoreToken` 未导出（`chalaoshi.js:108`），测试只能通过排序间接观察。

**最小改法**：按 `match` 种类各取一条命中，断言 `score` 落在档位决定的**区间**内；再补一条 hot 差异很大的两人断言「分数差随 hot 变化」—— 后者会**同时把 M1 变红灯**。

---

## 做得对的地方（6 条）

1. `scoreToken` / `splitQuery` / `isSubsequence` / `parseRate` **逐档逐行忠实**，无隐藏行为差异
2. `request` 注入式设计让数据层零 IO、4 条路径可用 `fakeRequest` 测死，**比上游直接吃 ctx 更好测**
3. 拒绝型文案是产品级（替用户排除「去配 WebVPN」这条歧路）且被测试钉住
4. 实测记录被**更新**而非照抄（2026-11-10 复测）
5. D17 层守得干净（无工具/无写/requires 双向一致/命名不撞/惰性 inject）
6. README 的「已知限制」自曝家丑

## 未找到（代理明确不编）

- 无真实索引样本或 hot 分布数据（决定 M1 严重度）—— 上游也只给 10295 总数
- 无 `connection` 版路由可比对，故「在只有 connection、没有 webServer 的精简宿主里会静默缺路由」标为**推测，未验证**
- 无客户端半边，无法核对 UI 是否会误展示 `degraded`

---

## 两个包对比：同一种失败模式

| | cnki | chalaoshi |
| --- | --- | --- |
| 测试数 | 31 | 23 |
| 测试全绿 | ✅ | ✅ |
| 阻断问题 | 5 | 2 |
| **共同根因** | **夹具配合实现** | **夹具配合实现** |

具体对照：

| 现象 | cnki | chalaoshi |
| --- | --- | --- |
| 夹具掩盖公式错误 | 登录字段名自造 | **hot 90/40 都 ≥30，掩盖 `/10` vs `/maxHot`** |
| 夹具掩盖逻辑缺失 | 滑块同时含两个关键词 | **`ratedOnly` 在空数组上真空真** |
| **上游实测数据未被用作测试基准** | 无 | **超时数值（1.7–3.0s 等）全部丢失 —— 正是 B1 的来源** |
| 集成层零测试 | `index.js` 零覆盖 | `index.js` 零覆盖 |

**这是同一条教训的两次复现**：手写夹具 + 不保留上游实测数据 = 测试证明「实现和夹具一致」，而不是「实现和真实世界一致」。
