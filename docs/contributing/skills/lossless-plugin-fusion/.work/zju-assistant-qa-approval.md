# Q-A 裁决：审批服务与工具注册流程（定稿）

**依据**：用户指示「参考 .ref 下的 deepseek harness 正常 tool 注册流程」。
**取证**：`.ref/packages/interaction/user-approval/`、`.ref/packages/core/tools/`、
`.ref/packages/todo/tool-todo/`、`.ref/packages/bundle/base/cordis.patch.yml`。

**结论**：**不新建审批服务**。宿主 `dsh-bundle-base` 强制提供 `ctx.approval`，本仓只需写一层薄封装。

---

## 一、宿主已有审批服务（推翻我上一版判断）

`@deepseek-ai/dsh-user-approval`，在 `.ref/packages/interaction/user-approval/`。

### 服务名与形态

```ts
// src/index.ts:25-29
declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }
}
```

`ApprovalService extends Service`，构造里 `super(ctx, 'approval')`（`index.ts:177`）。
**服务名就是 `ctx.approval`**。

### 装配证据（V-3 / V-4 的答案）

`.ref/packages/bundle/base/cordis.patch.yml:259-262`：

```yaml
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"
```

同文件 `:267-276` 的三档权限模式：

```yaml
read-only:          { sandbox: read-only,         approval: ask   }
workspace-write:    { sandbox: workspace-write,   approval: ask   }
danger-full-access: { sandbox: danger-full-access, approval: never }
```

**三条结论**：
1. `approval` 服务由 **base bundle 强制装配**，任何基于 base 的 profile 都有它。
   本仓 `profiles/zju-workbench/cordis.patch.yml` 没写它，**是因为它已经在 base 层了**，不需要重复挂。
   我上一版把「本仓 profile 没挂」读成「没有这个服务」，这是错的 —— 那只是 patch 层不重复声明。
2. `danger-full-access` 模式下 `policy` 直接是 `never` → 所有审批提问**自动 rejected**。
   **这正好解释了当前这次会话**：系统提示里写着「Approval prompts are disabled」，
   且 `danger-full-access` 模式。任何写操作在本会话下都会拿到 `'rejected'`。
3. `workspace-write`（默认）下 `policy: ask`，走 answerer 链。

### 对外契约（`index.ts:242-261`）

```ts
async request(req: ApprovalRequest): Promise<ApprovalOutcome>
```

| `ApprovalRequest` 字段 | 必填 | 说明 |
| --- | --- | --- |
| `agent: Agent` | 是 | 谁的请求；路由 answerer，审计写进它的 session log |
| `toolName: string` | 是 | 展示与审计 |
| `callId?: ToolCallId` | 否 | 关联已流式呈现的那次调用 |
| `reason?: string` | 否 | 提问原因 |
| `displayReason?: { en, [locale] }` | 否 | **仅本地化展示，从不持久化** |
| `signal?: AbortSignal` | 否 | 中止即撤销，结算为 `cancelled` |

返回值是封闭联合（`types.ts:32`）：

```ts
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

**只有 `'allowed-once'` 是授权。**

### 四条硬约束

1. **必须在已开启的 turn 内调用**（`index.ts:244-250`），否则抛
   `approval.request() outside an open turn`。审计对 `approval/asked` + `approval/decided`
   必须被 turn 包住；裸事件在崩溃恢复时是「垃圾尾巴」。
   → **后台任务（`feed.start()`、`watch.start()` 这类定时器）不能发起审批。**
   这对将来接「定时任务做写操作」是硬限制。
2. **`'never'` 在服务内部直接判掉**（`index.ts:301`），**早于任何 listener**。
   注释写明：`prepend: true` 的 listener 会排在 gate listener 之前，
   只有服务自己的 request 路径才能保证 `never` 确定性拒绝。
   → 业务侧**不要**自己再写一遍 `never` 来判断放行；只用来**选措辞**。
3. **answerer 缺失或抛错 → `'unavailable'`**（`index.ts:306-318`），fail closed。
   非词表的返回值也被规范化成 `'unavailable'`。
4. **审计必然成对**：`approval/asked` 与 `approval/decided` 一一对应（`types.ts:44-58`），
   由服务分配 `ApprovalRequestId`。

### 策略优先级

```ts
overrideOf(session) ?? config.policy ?? 'ask'   // index.ts:271
```

`overrideOf(session)` 是**公开方法**（`index.ts:279`），读 session 投影里最后一次 `approval/policy`。

---

## 二、上游 `approval.mjs` 逐条核对

`packages/vendor/zju-assistant/plugin/host/approval.mjs`（26 行）：

| 上游写法 | 宿主契约 | 吻合 |
| --- | --- | --- |
| `ctx.get('approval')` | 服务名 `approval` | ✅ 且符合「可选服务用 `ctx.get`」规则 |
| `approval.request({ agent, callId, signal, ...request })` | 签名一致 | ✅ |
| `outcome === 'allowed-once'` 才放行 | 契约如此 | ✅ |
| `approval.overrideOf?.(agent.session) ?? approval.config?.policy` | 两者都公开 | ✅ |
| `ctx.get('agents')?.roots().includes(agent)` 判子任务 | `agents` 服务存在（base bundle 有 `agents`），`roots()` 未逐字核实 | ⚠️ V-1 |
| 无 approval / 无 `exec.agent` → 抛错 | `ctx.get` 返回 undefined 时合理 | ✅ |

**结论：上游这段代码照着宿主契约写的，可直接移植。** 唯一待核实 V-1。

---

## 三、工具注册的标准流程（本仓照此写）

### 3.1 导出面

`tool-todo/src/index.ts:22-23`：

```ts
export const name = 'tool-todo'
export const inject = ['tools', 'sessionProjections']
```

`.ref/packages/AGENTS.md` 硬规则：
- **函数式插件**：named-export `name` / `inject` / `Config` / `apply`，**不得有 default export**
- **服务式包**：default-export 服务类
- 混用会让 Loader 丢弃函数插件的命名空间（有 postmortem 记录）

### 3.2 `apply` 签名

```ts
export async function apply(ctx: Context, config: Config): Promise<void>
```

### 3.3 注册动作

```ts
ctx.tools.register(defineTool({
  name: 'todo_write',
  description: describe(allowParallel),
  parameters: { /* ParameterSchemaSpec */ },
  output: {
    schema: { /* JsonSchemaNode */ },
    render: (_args, value) => [{ type: 'text', text: '...' }],
  },
  execute(args, exec) { /* 返回 canonical JSON */ },
  presentCall: args => ({ card: 'generic', title: '...', kind: 'other', rawInput: args.todos }),
}))
```

### 3.4 `defineTool` 字段（`core/tools/src/contracts.ts:26-101`）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` / `description` / `parameters` | 是 | 来自 `ToolSchema` |
| **`output`** | **是** | 「Mandatory canonical output declaration」：`{ schema: JsonSchemaNode, render(args, value) → ContentBlock[] }` |
| `execute(args, exec)` | 是 | 只返回 canonical JSON；异步必须观察/转发 `exec.signal` |
| `timeoutMs` | 否 | **永不下发给模型**；由 `dsh-tool-call-timeout-policy` 强制 |
| `isConcurrencySafe` | 否 | 只有返回 `true` 才并行；缺省独占 |
| `presentCall` / `presentResult` | 否 | 纯函数、可重放 |

### 3.5 `ToolRunContext`（`contracts.ts:174-224`）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `callId: ToolCallId` | 是 | |
| `agent?: Agent` | 否 | **可能为空**，上游 `zju-tool.mjs:86` 用 `exec.agent?.session` 是对的 |
| `signal: AbortSignal` | 是 | |
| `token` / `rootCallId` / `arguments` / `name` | — | executor 提供 |

### 3.6 注册即 effect

`.ref/AGENTS.md`：「**Registrations are effects**」——每个 contribution 都经
`ctx.effect()` / `ctx.on()`；`register()` 直接或经其 handle 返回 disposer。

`ctx.tools.register()` 返回 `() => void`（`core/tools/src/index.ts:128`）。
本仓 `packages/tool/study/src/index.js:53` 写的是 `ctx.effect(() => ctx.tools.register(tool))` —— **符合**。

---

## 四、对清单的修正

### 取消 P0-1（新建审批服务包）

| 原判断 | 错在哪 |
| --- | --- |
| 「本仓零审批 → 需自建 tier 0 审批包」 | 本仓零审批是**因为还没接写操作**，不是因为缺服务。宿主 base bundle 已强制装配 `ctx.approval` |
| 「本仓 profile 没挂 user-approval」 | 那只是 **patch 层不重复声明**；它在 base 层（`bundle/base/cordis.patch.yml:259`） |

### 改为 P0-1'（薄封装，非新服务）

| 项 | 内容 |
| --- | --- |
| 目录 | `packages/core/zju-write-guard/` |
| 职责 | 移植上游 `approval.mjs` 的 `askToWrite(ctx, exec, request, notDone)`，供 7 个写操作模块统一调用 |
| 不做什么 | **不提供 `ctx.approval`**（会撞宿主服务名） |
| 依赖 | `@deepseek-ai/cordis`（peer） |
| 规模 | 26 行移植 + 措辞 + 子任务判定 |
| 测试 | 5 条：allowed-once 放行 / rejected 抛出 / cancelled 抛出 / unavailable 抛出 / 无 agent 抛出 |

### 待核实

| 编号 | 事项 | 影响 |
| --- | --- | --- |
| V-1 | `ctx.get('agents')` 是否有 `roots()` | 子任务判定；没有则退化为「子任务也会弹审批」 |
| V-2 | `{ type: 'json' }` 是否被 `JsonSchemaNode` 接受 | 上游 9 个工具都用这个 output schema |

---

## 五、连带影响

1. **tier 0 只剩 WebVPN 升级（W1–W4）**，审批不再是基础设施项。
2. **9 个 tool 包有了确定范式**：named-export + `ctx.effect(() => ctx.tools.register(defineTool({...})))`。
3. **`output` 必填**：上游全部提供，符合契约；但 `{ type: 'json' }` 需 V-2 确认。
4. **写操作正确写法**：
   ```ts
   async execute(input, exec) {
     await askToWrite(ctx, exec, { toolName: 'zju', reason, displayReason }, '命令没有执行')
     // ...真正执行
   }
   ```
   不要自己判 `never`（宿主已兜底），只用来选措辞。
5. **后台定时器不能审批** —— `feed.start()` / `watch.start()` / `learnKit.prepare()`
   这类不在 turn 内的任务，不能发起写操作审批。将来若要做「定时交作业」之类，架构上不允许。
6. **本会话实测**：当前 `danger-full-access` → `policy: never` → 任何审批请求都会拿到 `rejected`。
   这不是 bug，是设计。
