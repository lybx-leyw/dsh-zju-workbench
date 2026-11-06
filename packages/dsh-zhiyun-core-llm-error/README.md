# dsh-zhiyun-core-llm-error

DeepSeek 官方接口的**错误分类与处置策略**。纯函数、零网络、零 UI。

## 为什么需要它

「调用失败了」不是一个足够的信息。DeepSeek 官方文档列了 7 个状态码，
但它们背后是**四类完全不同的动作**：

| 动作 | 错误码 | 该怎么办 |
|---|---|---|
| **先修**（不要重试） | 400、401、402、422、403 | 请求或环境本身有问题，重发同一个请求结果不变 |
| **降并发 + 退避** | 429 | DeepSeek 的限制口径是**并发数**，先减在飞请求比 sleep 有效 |
| **谨慎重试** | 500、503 | 服务端故障，短暂等待再试，盯持续率 |
| **客户端侧改** | 流停滞 / 连接超时 / 读超时 | 改的是本地超时策略，不是重发 |

混错的代价很具体：

- **402 当 429**：余额不足却一直退避重试 → 烧时间且永远失败。
- **429 当 402**：把"等一会儿就好"报成"要充值"。
- **422 只看码**：它可能承载「参数类型错」「上下文超限」「工具 schema 缺字段」
  「tool.content 为空」四种，修法各不相同，只看码会让人去改一个本来没错的字段。

所以本包的产物是**动作**，不是错误码表。

## 用法

```js
import { withRetry, classifyError, guardedStream, ACTION } from 'dsh-zhiyun-core-llm-error';

// ① 自动重试 / 降并发
const result = await withRetry({
  concurrency: 4,
  send: ({ concurrency }) => callDeepSeek({ concurrency }),
});

// ② 只分类，自己决定
try { await callDeepSeek(); }
catch (error) {
  const r = classifyError({ status: error.status, message: error.message });
  if (r.action === ACTION.FIX) reportToUser(r.hint);
}

// ③ 流式：独立 idle 超时（DeepSeek 的 SSE 会静默停推）
for await (const chunk of guardedStream(response.body, { idleMs: 45_000, controller })) {
  // …
}
```

## 支持的失败面

**官方 7 个码**：`bad_request`(400) · `unauthorized`(401) ·
`insufficient_balance`(402) · `invalid_parameter`(422) · `rate_limited`(429) ·
`server_error`(500) · `service_busy`(503)

**文档未单列、但实际会遇到**：

| 失败面 | 承载它的码 | 为什么单独列 |
|---|---|---|
| `reasoning_not_echoed` | 400 | DeepSeek 推理模型独有：思考模式必须回传 `reasoning_content` |
| `context_overflow` | 422 / 400 | 与「参数类型错」修法不同：要减输入或降 `max_tokens` |
| `tool_schema_invalid` | 422 | `tools[i]` 缺 `name` 等 |
| `empty_tool_content` | 422 | `tool` 角色 `content` 传空串被拒 |
| `region_blocked` | 403 | 地区 / IP 限制，或模型需 workspace opt-in |
| `stream_stalled` | （无码） | HTTP 200 但不再推 chunk |
| `connect_timeout` / `read_timeout` | （客户端） | 不是服务端返回的 |

## 三条设计纪律

**① 不确定时不重试。** 重试只对「同一个请求再发一次可能成功」的失败正确。
拿不准属于哪一类时一律给 `fix` —— 宁可让调用方早一点把问题报给人，
也不要让它在重试里被稀释成「偶发失败」。

**② 429 的正确第一步是降并发，不是 sleep。** DeepSeek 的并发限制**以账号为粒度、
与 API Key 无关**，多建 Key 分摊不了。所以 `decide()` 会返回 `nextConcurrency`，
调用方应当真的把并发调下去。

**③ 流停滞要独立 idle 超时。** 只设 300 秒请求总超时的话，一次静默停滞要
5 分钟才发现，那几分钟全白等。30–60 秒的 idle 超时能在"明显不对劲"时就断掉。

## 为什么先只做 DeepSeek

上面几条里有三处是 DeepSeek 独有的口径：402 是独立计费码（多数服务商折进 429）、
429 以并发为核心口径、思考模式必须回传 `reasoning_content`。

别家未必这样。所以 `SUPPORTED` 现在只有 `deepseek` —— 加别家要**重新核那家的码表**，
而不是把 DeepSeek 的策略套上去。

## 验证

```bash
node --test tests/llm-error-classify.test.mjs tests/llm-error-policy.test.mjs
```

37 项：7 个码 × 动作、422 的四种细分、403 与 5xx 家族、客户端侧三类、
「不确定不重试」、402/429 不可混，以及重试次数上限、并发下调、流停滞计时。
