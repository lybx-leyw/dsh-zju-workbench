# 学在浙大待办：我们 vs `zju-mcp` / 上游 `ZJU-live-better-main`

对比对象（都在 `~/Desktop/zju-mcp/zju_bridge/`）：

| 来源 | 文件 | 数据源 | 请求数 |
| --- | --- | --- | --- |
| **本仓** | `packages/dsh-zhiyun-source-campus/src/xzzd.js` | 逐课 5 端点 | `5 × 课程数`（11 门课 = 55） |
| `zju-mcp`（MCP 型） | `vendor/vibe-learning-in-zju/zju-mcp.mjs` `toolListTodos` | **`/api/todos?no-intercept=true`** | **1** |
| 上游「可靠版」 | `vendor/ZJU-live-better-main/courses.zju/reliableTodolist.js` | 逐课 5 端点 | `5 × 课程数` |
| 上游「原始版」 | `vendor/ZJU-live-better-main/courses.zju/todolist.js` | `/api/todos` | 1 |

## 逐项对比

| 维度 | 本仓 | `zju-mcp` | 判断 |
| --- | --- | --- | --- |
| 端点 | `/api/todos`（**无参数**） | `/api/todos?`**`no-intercept=true`** | ⚠️ **我们少了这个参数** |
| 过滤口径 | 自己算：已发布 + 未截止 + 已开始 + 未提交 + 没满分 | 服务端已过滤，客户端只排序 | 我们更严（但多出的过滤原本也不该进待办） |
| 课堂互动 | 算进待办（`classroom-list`） | **不算** | 我们多这一类 |
| 时间 | `normalizeDeadline`：无时区按 +08:00 解释 | `shanghaiDate`：固定 +8 小时换算 | 等价 |
| 会话 | `SessionStore` + DPAPI 落盘，跨次复用 | `sharedSession`，TTL 缓存 | 等价 |
| 失效重试 | 只重试那一次读，不重跑整个爬取 | `withRetry` 整体重登重试一次 | 我们更省 |
| 出网 | `egress`（undici Agent 逐请求 dispatcher） | 裸 `globalThis.fetch` | 我们多一层（但换来绕开全局代理） |
| 请求数 | 55 | **1** | 差 55 倍 |

## 三件值得注意的事

### 1. `?no-intercept=true` —— 我们漏了这个参数

`zju-mcp` 调的是 `/api/todos?no-intercept=true`，我们是 `/api/todos`。

这个参数名的含义是"不要拦截"——该站有一层响应拦截器（从 `zju-mcp` 里
`/api/course/{id}/homework/submission-status?no-intercept=true` 等多处都带它可以看出）。
**没有它时返回体可能被改写**，这足以解释「同样是 `/api/todos`，
有人拿到完整列表、有人拿到残缺列表」。

这是本次对比**唯一一个能直接照抄的修正**，已改。

### 2. 「会漏」这句断言的出处与强度

传下来的说法是「`/api/todos` 会漏」。追溯结果：

- 上游 `reliableTodolist.js` 文件头：只写了 `避免 /api/todos 的 bug`，**没写是什么 bug**
- `courses_todos_reliable.py` 文档：`上游把这个版本叫「reliable（可靠）」—— 因为 /api/todos 会漏`
- 再往上就断了：Flutter 版源文件不在本仓，也没有复现条件

而 `zju-mcp` 的作者显然**不认同**这条结论 —— 它就是用 `/api/todos` 的，而且
README 里把它当作正常功能。你实际用下来「感觉没漏过」也支持这一点。

**所以这条断言强度很弱：只有结论，没有证据，且存在反例实现。**

### 3. 结构性差异：课堂互动

`/api/todos` 的返回项类型（`TODO_TYPE_CN`）只映射了
`homework / exam / quiz / survey` —— **没有课堂互动**。

而逐课版会把 `classroom-list` 里 `status === 'start'` 的活动算成待办。

所以「漏」最可能指的是**课堂互动这一类**，而不是作业/测验。
这与「作业没漏过」的体感不矛盾：课堂互动本来就少。

## 结论与改法

**已实现，但默认值没有改**——这是刻意的：

- `ZHIYUN_TODOS=slow`（**默认**）：逐课，`5N` 个请求，现有行为不变
- `ZHIYUN_TODOS=fast`：`/api/todos?no-intercept=true`，**1 个请求**
- `ZHIYUN_TODOS=diff`：两条都跑，输出差异（诊断用）

为什么不直接把默认切成 `fast`：「会漏」这条断言虽然弱，但**证据不足时默认值
应当保守**。直接改默认等于拿用户的待办做实验，而多跑一次 `diff` 的成本很低。
等 `diff` 给出对账数据（`missingFromFast` 为空 = 作业/测验没漏），再切不迟。

（我先前一版把默认改成了 `fast`，结果 `campus-planning-contract.test.mjs`
立刻全红 —— 6 条测试的夹具只模拟了逐课端点。这也从侧面说明：默认值的改动
会牵动既有约定，不该顺手做。）

对账函数 `diffTodos()` 把「只在逐课版里有」的条目按类型分开，
其中 `missingFromFast` **只统计作业/测验**（排除结构上就不会有的课堂互动）。
它为空，就说明聚合端点对作业/测验没有遗漏。

## 关于 65 秒

11 门课 / 55 请求 / 60.8 秒 = **1.1 秒/请求**，对校园网内的 API 明显异常。

已排除的怀疑：

- 连接复用：`egress` 的 `Agent` 是复用的（`agentFor()` 里惰性建一次），不是每次新建
- 并行是否生效：本地用真实 HTTP 服务器 + 真实 `Transport` + undici 实测，峰值并发确实是 5
- cookie 读写：`getCookies` 同步，`save()` 有 `pending` 串行保护且只在收到 `Set-Cookie` 时写盘

剩下的可能是网络路径或服务端。为此加了**单请求耗时分布**（p50 / p90 / max），
不再是只看均值——均值会把「2 个请求卡 10 秒」掩盖成「每个都慢几百毫秒」，
而这两者的优化方向完全相反。

`zju-mcp` 那边因为只用 1 个请求，**它的绝对耗时本身就能作为对照基准**：
如果它也是 1 秒级，那是链路问题；如果它是 100ms 级，那我们的 Transport
里有东西在拖慢每个请求。
