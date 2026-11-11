# 溯源结果 · 代理 1：工具注册与执行链路

**来源**：子代理只读溯源 `.ref`（checkout `66491b05e3`，版本 `0.2.2-rc.1`）。
**结论覆盖**：V-2（`{type:'json'}`）、Q2（`register()` 契约）、Q3（工具可见性机制）。

---

## 一、V-2 已解决：`{type:'json'}` 合法

### 结论

**合法**，但合法的层次要说清楚：

| 层 | 类型 | 有 `'json'` 吗 |
| --- | --- | --- |
| 作者 DSL | `ValueSchemaSpec`（`core/tools/src/schema.ts:86-95`） | **有**：`JsonValueSchemaSpec = { type: 'json' }`（`schema.ts:75-78`） |
| wire 层 | `JsonSchemaNode`（`core/tools/src/json-schema.ts:31-56`） | **没有**：`JsonSchemaType` 闭集只含 `object/array/string/number/integer/boolean/null`（`json-schema.ts:21,87`） |

`defineTool()` 会把 `{type:'json'}` **编译成只有注解、没有 `type` 的 `{}`**：

```ts
// schema.ts:360-365
case 'json':
  assertAuthorKeys(input, path, [...authorKeys, 'type'])
  copyAnnotations(input, node)     // ← 只拷 description/title/default/examples
  break                            // ← 不设 node.type
```

所以 vendor 9 个工具**注册与执行都不会报错**，输出校验退化为「任意无损 JSON」
（`json-schema.ts:537-551`：`nodeType === undefined` → 只查 `safelyIsJsonValue`）。

### 反例（唯一会失败的情形）

**绕过 `defineTool`、直接把裸 `ToolDefinition` 交给 `register()`** 时，
`assertSupportedJsonSchema`（`core/tools/src/index.ts:136`）会**同步抛**
`JsonSchemaError`，code `UNSUPPORTED_SCHEMA`（`json-schema.ts:65-74`）。
不是静默通过，也不是 execute 后才校验。

### 官方佐证

| 证据 | 内容 |
| --- | --- |
| `core/tools/tests/schema.spec.ts:21-22` | `{type:'array', items:{type:'json'}}` → `{type:'array', items:{}}` |
| `core/tools/tests/tools.spec.ts:350-356` | 用 `{type:'json'}` 的 `defineTool` 注册成功并执行 |
| `docs/subsystems/tools.md:144` | 「`{type:'json'}` infers `JsonValue` and compiles to an annotation-only unconstrained raw schema」 |

### 对上游 9 个工具的判定

`packages/vendor/zju-assistant/plugin/host/tools.mjs:6,9,23-33` 走的是 `defineTool` 路径，
`:51,71,89,113,167` 共 5 处 `ctx.tools.register`，加上 `zju-tool.mjs:71`、
`rows/mail.mjs:8,15,71` / `wechat.mjs:13,32` / `chat.mjs:10` 复用同一 `output`。

**结论：全部合法，无需改。**

### 可选改进（不强制）

若想从「任意 JSON 值」收紧到「任意 JSON **对象**」：

```js
output: { schema: { type: 'object', additionalProperties: true }, render: ... }
```

依据 `schema.ts:69-73`（`ObjectValueSchemaSpec` 强制显式 `additionalProperties`）。

**清单动作**：V-2 关闭；9 个工具照抄 `{type:'json'}` 即可。

---

## 二、Q2 补充：`register()` 的完整契约

### 签名与 disposer

```ts
// core/tools/src/index.ts:121-128
/**
 * Register globally or in the calling agent scope. Scoped tools shadow globals;
 * duplicates within one layer and the reserved `run_code` name fail.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void
```

- disposer **幂等**（`core/scope/src/store.ts:43-54` 的 undo 带 `active` 标志）
- **插件/fiber 卸载自动注销**（`tools.spec.ts:2150-2162` 的 HMR 安全测试）
- 触发 `tools/change` 事件（`index.ts:106` → `events.ts:50-56`）

### 注册期硬约束（全部同步抛）

| 约束 | 位置 |
| --- | --- |
| `output` 必须 `{schema, render, presentationMeta?}` | `index.ts:131-135` |
| `output.schema` 必须属于强制子集 | `index.ts:136` |
| `timeoutMs` 必须正有限数 | `index.ts:137-141` |
| 名字不得为 `run_code`（**无条件保留，连遮蔽都不允许**） | `index.ts:145-147` |

**注意**：`parameters` **不在** register 阶段做子集校验，只在投影时校验「无损 JSON」（`schema.ts:644`）。

### 模型可见字段（核实 `contracts.ts:64-67`）

**代理纠正了我引用的一处措辞**：白名单是四项，不是三项 —— 漏了 `deferLoading`。

第一道（`core/tools/src/schema.ts:641-646`）：
```ts
const { name, description, parameters, deferLoading } = definition
```

第二道（`core/system-prompt/src/index.ts:649-654`）重新构造，连 `deferLoading` 都显式列出。

| 字段 | 进模型请求 |
| --- | --- |
| `name` / `description` / `parameters` | ✅ |
| `deferLoading`（仅 `true` 时） | ✅ |
| `output` / `timeoutMs` / `isConcurrencySafe` / `presentCall` / `presentResult` / `execute` | ❌ |

---

## 三、Q3 重大修正：preset 的真实机制

### 我之前的理解是错的

我一直按「工具全局注册 → preset 过滤」来理解。**宿主没有这种机制。**

`PresetDefinition` 只有 `plugins: EntryOptions[]`（`agent-preset-registry/src/definition.ts:5-11`），
**没有**工具 allow/deny 清单字段。

### 真实机制：preset = 一棵独立的 Cordis scope 子树

`AgentPresetRegistry.activate()`（`agent-preset-registry/src/index.ts:119-138`）：

```
createScope(this.owner, key) → mountPreset(context, id, plugins)
```

即 **每个 preset 建一个独立 scope，并在其中挂载整棵插件树**（`mount.ts:204-216`）。
工具在 preset 子树里 `register()`，`scopeOf(ctx)` 决定它落到该层（`core/scope/src/index.ts:149-156`），
`view(scope)` 只沿 scope 链取层（`core/tools/src/index.ts:199-227`）。

**所以 preset A 子树里注册的工具，对绑定 preset B 的 Agent 根本不在这条链上。**

### 决定性证据

`agent-preset-registry/tests/registry.spec.ts:28-31`：

```ts
expect(ctx.tools.schemas(first).map(r => r.name)).toEqual(['standard'])
expect(ctx.tools.schemas(second).map(r => r.name)).toEqual(['minimal'])
expect(ctx.tools.schemas(third).map(r => r.name)).toEqual(['standard'])
expect(ctx.tools.schemas()).toEqual([])     // ← 全局视图里一个都没有
```

最后一行正是本仓要的：「preset 内注册的工具不污染全局工具表」。

### `ToolRegistrationOptions` 不能限定作用域

```ts
// core/tools/src/contracts.ts:104-124
export interface ToolRegistrationOptions {
  readonly when?: (context: ToolActivationContext) => boolean | Promise<boolean>
}
```

**只有 `when`，没有作用域参数。** 作用域来自 `scopeOf(this.ctx)`（`index.ts:148-152` → `store.ts:231`）。
（代理还指出：任务里说的 `activate` 字段在源码中不存在，实际叫 `when`。）

### 「某工具只在某 preset 可见」的三种做法

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| **A（推荐，原生）** | 把工具的插件行**只**写进目标 preset 的 `config.plugins` | 需要新写一个 `@deepseek-ai/dsh-agent-preset` 声明行 |
| B（轻量门控） | 全局注册 + `when: ({agent}) => agent.ctx.get('agentPresets')?.composedPreset(agent.ctx) === 'zju'` | 工具名仍占全局注册表；同层重名仍会抛 |
| C（子 agent） | `childCtx.tools.restrict({allow/deny})` | 只适合给子 agent 裁剪，不解决 preset 分表 |

方案 A 的 YAML 形状（照 `bundle/web-app/presets/cordis.patch.yml:4-10`）：

```yaml
- insert:
    - id: preset-cordis
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: cordis
        order: 4
        plugins:
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config: { allowParallelInProgress: true }
```

### **上游现状的根因（重要）**

`packages/vendor/zju-assistant/plugin/bundle/cordis.patch.yml:7-31` 用的是**顶层 `- insert:`**，
把这些行插入 profile 根层 → **注册成全局工具** → 这就是「9 个校园工具出现在所有会话工具表」的根因。

要满足「只在特定 preset 出现」，必须**改造成一个 `dsh-agent-preset` 声明行，把 `dsh-zju-campus*`
行搬进它的 `config.plugins`**，而不是加 `when`、也不是加 `restrict`。

---

## 四、其他新发现（清单需要记录）

### 4.1 `run_code` 无条件保留

`index.ts:142-147`：无论 global 还是 scoped，注册即抛，且**禁止遮蔽**。
注释解释：任何 agent 都可能自选代码模式。

→ 本仓 9 个工具的名字都不会撞它，但要注意**不要**起名 `run_code`。

### 4.2 同名冲突三种行为

| 情形 | 行为 | 位置 |
| --- | --- | --- |
| 同层重复名 | **同步抛错** | `index.ts:63-71`、`store.ts:43-45` |
| 跨层同名 | **静默遮蔽**，近处盖远处，无日志无事件 | `index.ts:199-227` |
| `run_code` | 无条件抛 | `index.ts:142-147` |

**跨层静默遮蔽是隐患**：两个包抢同一名字不会有任何提示。
→ 清单需要加一条自检：启动时对比 `knownNames` 与实际注册来源。

### 4.3 `parameters` 的校验时机

注册期**不**校验 `parameters` 的子集合法性；只在投影时校验「无损 JSON」
（`schema.ts:644`，测试 `tools.spec.ts:2130-2139`）。

→ 意味着 `parameters` 写错了会在**每步装配时**才报错，不是启动时。

---

## 五、对清单的更新

| 原条目 | 更新 |
| --- | --- |
| V-2 `{type:'json'}` 是否合法 | **关闭**：合法，`defineTool` 编译为注解节点；9 个工具照抄即可 |
| Q-E / D11 preset 机制 | **机制已查明**：preset = 独立 scope 子树，工具行写进 `config.plugins` 即隔离。**但这不改变 D11 的「延迟决策」** —— 延迟的是「挂哪个 preset」，不是「怎么挂」 |
| 新增待办 | 工具包实施时必须用 preset 子树方式，**不得**沿用上游顶层 `- insert:` 写法 |
| 新增自检 | 跨层同名静默遮蔽 → 需要启动期检查 |
