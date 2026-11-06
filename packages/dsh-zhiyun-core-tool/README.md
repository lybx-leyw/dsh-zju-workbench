# dsh-zhiyun-core-tool

智云 Pro 的**工具协议与调度层**。上游 `DeepTutor` 对应模块的纯 JS 重写，零第三方依赖、
零 UI、零落盘、不真调模型。

## 这是干什么的

模型说「我要调 `read_source`，参数是这些」之后，发生的事全在这里：

1. **schema 生成** —— 把工具定义变成模型能读的 JSON Schema（OpenAI `tools` 参数格式）
2. **参数守卫** —— 模型漏了必填参数时，在派发前拦下来，回一段能让它自纠的话
3. **并行调度** —— 一轮里的多个工具调用并发执行，各自一张 trace 卡，结果按原顺序回填
4. **结果序列化** —— 拼成 `role=tool` 消息，喂回模型继续下一轮
5. **循环控制** —— 决定什么时候停（标签协议 / 工具要求终止 / 预算耗尽）

## 装与跑

```bash
node tests/core-tool.test.mjs    # 82 项，全绿
node --check src/index.js
```

## 对外契约

```js
import { createToolRegistry } from 'dsh-zhiyun-core-tool';

const registry = createToolRegistry();

registry.register({
  name: 'read_source',
  description: 'Read one attached source by id.',
  parameters: [
    {name: 'source_id', type: 'string', description: 'Source id', required: true},
    {name: 'query', type: 'string', description: 'What to look for', required: false},
  ],
  handler: async (args, ctx) => ({content: '...', sources: []}),
});

registry.resolve(['read_source'], ctx);      // → tool[]
registry.schemas(['read_source']);           // → JSON Schema[]，直接塞进 OpenAI tools
await registry.dispatch(                     // → {ok, result} | {ok:false, error}
  {id: 'c1', name: 'read_source', arguments: {source_id: 's1'}},
  {stream, context},
);
```

### 三套循环，别混

| | 驱动方式 | 谁决定收尾 |
|---|---|---|
| `runAgenticLoop` | 标签协议（`THINK`/`TOOL`/`FINISH`…） | `protocol.terminal`，**不是硬编码** |
| `registry.runToolLoop` | 原生函数调用 | 模型这一轮不再发 `tool_calls` |
| `registry.dispatchRound` | 只做一轮 | 调用方自己掌握模型客户端 |

出题链的 EXPLORE / PLAN / QUIZ / REPAIR 四个阶段各有一张不同的标签矩阵，
所以协议必须是**参数**。QUIZ / REPAIR 是裸 JSON，走原生函数调用那套。

## 关键不变量

改动前请先读 [NOTES.md](./NOTES.md)。最容易被"顺手简化"掉的三条：

1. **参数守卫不校验类型**。它只判「没来」和「来了但是空串」。类型错误交给工具自己拒绝。
2. **`streamBodyLive` 一开一关是刻意的**。开着时循环必须跳过 `emitFinal`，否则正文推两遍；
   关着时 QUIZ 的裸 JSON 才不会刷到用户脸上。
3. **结果按原始顺序回填**，不是按完成顺序 —— `role=tool` 必须与 assistant 的
   `tool_calls` 顺序一一对应，否则下一轮 provider 拒。

## 目录

```
src/
  index.js              对外导出（102 个符号）
  schema.js             工具定义 → JSON Schema
  arg-guard.js          必填参数校验 + 纠错文案
  dispatch.js           并行调度（本包核心）
  loop.js               标签驱动的 agentic 循环
  registry.js           createToolRegistry
  stream-bus.js         事件总线（顺序保证 + 可合并范围）
  stream.js / trace.js  事件与 trace 元数据
  messages.js           provider wire 形状的会话消息
  context.js            统一上下文
  capability.js         能力清单与目录
  request-contracts.js  请求契约（extra="forbid"）
  json.js               模型参数容错解析
  home.js               运行时 home 解析
tests/core-tool.test.mjs
NOTES.md                上游行为笔记（维护者的唯一线索）
```
