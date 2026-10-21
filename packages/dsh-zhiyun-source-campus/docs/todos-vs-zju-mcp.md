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

- `ZHIYUN_TODOS=fast`（**默认**）：`/api/todos?no-intercept=true`，**1 个请求**
- `ZHIYUN_TODOS=slow`：逐课，`5N` 个请求（旧行为，留作对照）
- `ZHIYUN_TODOS=diff`：两条都跑，输出差异（诊断）

默认切到 `fast` 的依据：真机 p50 = 2112ms/请求，在这种链路上**唯一有效的
手段就是少发请求**；而 `zju-mcp` 用同一个端点，实测「几秒就返回」。

（我先后把默认值改成 fast → 退回 slow → 又改回 fast。中间那次退回是
因为 `campus-planning-contract.test.mjs` 6 条全红——后来发现那是测试夹具
只模拟了逐课端点，应当在测试里**显式钉住 slow**，而不是让产品默认值迁就测试。
这个教训写进了该测试文件顶部。）

对账函数 `diffTodos()` 把「只在逐课版里有」的条目按类型分开，
其中 `missingFromFast` **只统计作业/测验**（排除结构上就不会有的课堂互动）。
它为空，就说明聚合端点对作业/测验没有遗漏。

## 关于 65 秒：根因找到了

11 门课 / 42 请求 / 48 秒 = **p50 2112ms 一个请求**。逐项排查后定位到：

**`SessionStore.save()` 每次都要 spawn 一个 `powershell.exe` 做 DPAPI 加密。**

本机实测：

| 操作 | 耗时 |
| --- | --- |
| 单次 DPAPI 子进程 | **1249ms** |
| 5 次 `await save()` | **5895ms**（约 1179ms/次） |
| 5 次 `scheduleSave()` | **2ms** |

而 `Transport.request` 原先在**每个**带 `Set-Cookie` 的响应后都
`await this.session.save()`。一次待办几十个请求 → 每个请求白等一秒多，
且这些保存因为 `pending` 串行化还会互相排队。

`zju-mcp` 用 `sharedSession`（**内存会话，不落盘**），所以几秒就返回。
这正是他们做得比我们好的地方：**不把持久化放进请求路径**。

修法不是"不保存"（那样重启要重登），而是 `scheduleSave()`：请求立刻继续，
落盘延迟 1.5 秒合并写一次。内存里的 jar 始终最新，同一次运行内行为不变。

预期：42 个请求 × 省下 ~1.2 秒/次 → 48 秒降到个位数。

## 顺带修的第二处：UA 不合法

| | UA |
| --- | --- |
| `zju-mcp` | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ... Chrome/124.0 Safari/537.36` |
| 我们（旧） | `Mozilla/5.0 Chrome/122.0.0.0 Safari/537.36` |

我们的串**缺平台段与内核段**，不是合法 UA。站点若按 UA 判断客户端类型，
残缺串可能被归到"非浏览器"而走不同处理路径。已换成完整串。

## 关于 65 秒

（已在上文定位到 `save()` 阻塞。）排查过程中排除的怀疑：

- 连接复用：`egress` 的 `Agent` 是复用的（`agentFor()` 里惰性建一次）
- 并行是否生效：本地用真实 HTTP 服务器 + 真实 `Transport` + undici 实测，峰值并发确实是 5
- cookie 读取：`getCookies` 同步，无额外 I/O

**新增诊断能力**：`Transport` 记每条请求的耗时（只留 `ms` / `path` / `status`，
不含凭证），`profile` 输出 p50 / p90 / max。只有均值不够 —— 2 个请求卡 10 秒
会把均值拉成"每个都慢几百毫秒"，而两者的优化方向完全相反。
