# 溯源结果 · 代理 2：审批与权限链路

**来源**：子代理只读溯源 `.ref`（未改文件、未跑构建、未读 node_modules）。

---

## 一、V-1 已解决：`roots()` 存在，但**语义是运行时所有权，不是「子任务」**

### 签名与实现

```ts
// core/agent/src/index.ts:621-625
roots(): Agent[] {
  return [...this.store.values()]
    .filter(entry => entry.owner === undefined)
    .map(entry => entry.agent)
}
```

JSDoc（`:615-621`）明确：

> All live top-level agents in registration order. A top-level agent was
> created without an owning agent context; **durable session lineage does not
> affect this runtime relation, so a resumed fork may still be a root**.

### 语义澄清（我之前的理解有偏差）

它**不是**「根会话 vs continuation」，而是「**这个活 agent 有没有一个活着的运行时父**」。

| 场景 | `roots().includes(agent)` | 实际是子任务吗 |
| --- | --- | --- |
| Web 主对话 agent | `true` | 否 |
| in-process subagent | `false` | **是** |
| 子 agent 的子 agent | `false` | 是 |
| headless 单任务 | `true` | 否 |
| resume 带 `parentSession` 但无 `parentAgent` | **`true`** | 否（因为 durable lineage 不影响） |

测试证据 `core/agent/tests/agent.spec.ts:132-153`：

```ts
expect(ctx.agents.list()).toEqual([root, child])
expect(ctx.agents.roots()).toEqual([root])          // 子不在 roots 里
expect(ctx.agents.isOwnedBy(child.id, root)).toBe(true)
```

### 上游写法的正确性判定

`plugin/host/approval.mjs:9` 用 `roots().includes(agent) === false` 判「子任务不能请用户批准」。

**在 DSH 现有全部创建路径上，这个判断等价于「是不是子任务」，不会误报。**

而且**这与宿主自己的写法一致**：`interaction/user-questions/src/index.ts:137-150` 的 `assertLiveRoot` 就用同一模式拒绝委派调用者（错误码 `DELEGATED_CALLER`）。另有 6 处宿主代码用同一模式。

**风险是语义耦合**：它依赖「所有非根 agent 都是委派子 agent」这个当前事实，而不是专门 API。若将来出现「用 `parentAgent` 建立所有权但仍是用户视角主对话」的场景，就会误报。

### 更精确的三种替代（按精确度）

| # | 方法 | 精确度 | 依据 |
| --- | --- | --- | --- |
| 1 | **`delegationDepthOf(agent) > 0`** | 最贴合「是不是子任务」 | `subagent/subagent/src/depth.ts:28-36`，读 `session.header.delegationDepth`；导出在 `src/index.ts:113`；宿主自己用它在 `tool-schedule/src/index.ts:306-308` 拒绝子任务。**durable，重启后仍在** |
| 2 | `ctx.agents.isOwnedBy(agent.id, owner)` | 最精确的运行时所有权 | `core/agent/src/index.ts:603-605`；需 owner，调用方通常得遍历 `list()` |
| 3 | `roots().includes(agent)` | 宿主事实标准，但语义耦合 | `user-questions/src/index.ts:137-150` 等 7 处 |

### 不存在的东西（避免误用）

| 想找的 | 实际 |
| --- | --- |
| `agent.parent` | **不存在**。`Agent` 只暴露 `id` + 运行时面（`runtime-types.ts:190-203`），父只记在 registry 的 entry 里 |
| `agent.initiator` | **不是所有权**。只有 `ctx.agents.currentInitiator()`，是 AsyncLocalStorage 的异步因果归因；`index.ts:246-250` 明说「Ambient presence is neither liveness proof nor authorization」 |
| `isSubagent()` | **不存在**。只有 `isSubagentDelegationTool(name)`，判的是**工具名** |

### 子 agent 的 policy 确实是 `never`，但不是装配层写死的

`subagent/subagent/src/child-agent.ts:248-255`：

```ts
export function captureDelegatedPolicyOverrides(parent: Agent): DelegatedPolicyOverrides {
  return {
    permissionPreset: ...,
    sandboxMode: ...,
    approvalPolicy: parent.ctx.get('approval') === undefined ? undefined : 'never',
  }
}
```

落盘在 `child-agent.ts:266-279`：`childSession.append('approval/policy', { policy: 'never', source: 'delegation' })`。

`manager.ts:404` 注释解释为何在第一个 await 前捕获：「a later parent switch belongs to the parent's future, not to this child」。

**例外**：只在 in-process 路径固定。外部 provider（Codex/Claude Code/ACP）走各自的无人策略（`subagent-codex/src/wire.ts:33-41`、`subagent-claude-code/src/run.ts:343-347`）。

---

## 二、审批链路全貌

```
request() → 检查 turnOpen → append('approval/asked')
  → decide():
      ① signal.aborted → 'cancelled'
      ② effectivePolicy === 'never' → 'rejected'（早于任何 listener）
      ③ waterfall(scopeTarget(agent,agent), 'approval/request', req, () => 'unavailable')
      ④ 归一化：抛错/非词表 → 'unavailable'
      ⑤ 与 abort 赛跑
  → append('approval/decided') → 返回
```

### answerer 的 4 类注册方

| 通道 | 位置 | 认领条件 |
| --- | --- | --- |
| Web GUI | `client/ui-approval/src/client/index.ts:107-109` | 无（客户端 scope 已被 Host 定向） |
| ACP | `acp/acp/src/index.ts:158-176` | `ownedRecord(request.agent)` 存在 && `callId !== undefined` |
| SDK JSON-RPC | `sdk/server/src/server.ts:130-147` | `ownsAgent(request.agent)` |
| 转发到 Web | `api/remotes/src/index.ts:59-78` | `carrierKeyOf(this)` 已定义且 `request.agent === carrierAgent` |

### `ui-approval` 做了什么

`client/ui-approval/src/client/index.ts`：
- `:80` 注册 8 语言字典
- `:81-89` 注册 Enter=allow / Esc=reject 快捷键
- `:90-92` `registerPendingInteraction<PendingApproval>`
- `:93-96` 注册 `conversation.approval.card` 槽
- `:97-106` composer 接管
- `:107-109` `ctx.remote.$on('approval/request', ...)`

**它不「认领」某个 agent** —— 认领靠 scope：Host 侧 `scopeTarget(req.agent, req.agent)` 建 carrier，`api/remotes` 用 `carrierKeyOf(this)` 校验，Gateway 只投给 `answers === true`（owner principal）的客户端。

### `displayReason` 确实不持久化

- 注释：`types.ts:72-73`「Localized presentation only; never persisted」
- `request()` 只写 `id/toolName/callId/reason`（`index.ts:252-257`）
- **后果：重载后 `displayReason` 丢失，UI 只能显示英文 `reason`**。这是设计，不是 bug

---

## 三、turn 约束（重要发现）

### `turn/start` / `turn/end` 的唯一写入点

`core/agent-loop/src/agent.ts:336`（start）与 `:422`（end）。全仓 `src/` 下**只有这两处**。

### 后台任务不能审批：两条独立原因

1. **没有 open turn** —— `setInterval` 回调不在 `driver.turn()` 里，`turnOpen` 为 `false`，`request()` 在 `index.ts:244-250` 抛错
2. **没有 agent 上下文** —— 审批要求 `req.agent: Agent`

### 宿主**没有**「排队到下一个 turn」的审批通道

`user-approval/README.md:164`：

> Requests are valid only inside an open turn — an idle or between-turn caller throws before auditing; **a durable out-of-turn approval workflow is deferred.**

全仓 grep `deferred.*approval|approval.*deferred|queue.*approval|approval.*queue` → **0 命中**（除了这句 README）。

### 正确的替代做法

| 机制 | 位置 | 说明 |
| --- | --- | --- |
| `agent.followup(message)` | `agent.ts:179-181` | 排队到 next-turn 并**唤醒 driver**，会真正开 turn |
| `agent.steer(message)` | `:183-185` | 排队到 next-step |
| `agent.inject(message)` | `:187-189` | **不唤醒**，仅作模型可见上下文 |
| schedule 交付 | `schedule/runtime.ts:352-362` | `agent.followup(...)` + `flush`；task 内层才有 turn |
| compaction 维护 | `compaction-basic/src/index.ts:414` | `runMaintenance`，**无 turn**，不能审批 |

**结论：后台任务的正确写法是「用 `followup` 唤醒一次真正的 turn，在那一轮里再 ask」**，而不是在定时器回调里直接 `approval.request()`。

### 子 agent 内部能调，但拿不到 `allowed-once`

`request()` 前置检查只有 `turnOpen`，没有「是不是子 agent」检查。但 `decide()` 第 301 行 `effectivePolicy === 'never' → 'rejected'`，子 session 已被钉 `never`，所以**在任何 answerer 之前就返回 `rejected`**。

对调用方而言，`rejected` 与「用户点了拒绝」无法区分 —— 这正是上游 `unasked()` 要解决的问题。**审计对仍然完整落盘**。

---

## 四、permission-presets 与三档映射

### 三档是**装配层配置**，不是代码硬编码

`bundle/base/cordis.patch.yml:264-276`：

```yaml
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:          { sandbox: read-only,          approval: ask   }
      workspace-write:    { sandbox: workspace-write,    approval: ask   }
      danger-full-access: { sandbox: danger-full-access, approval: never }
```

`Config.presets` 是 `z.dict(...)`（`index.ts:176-193`），**可在任何 profile/home overlay 覆盖**。

`read-only` 这一档**不在** `Config` 的 schema default 里（默认只有两档），说明它确实来自 YAML。

### 一处隐式耦合（值得记录）

`approval.policy`（`:262`）与 `presets.danger-full-access.approval`（`:276`）是**两处独立配置的同一语义**，由同一环境变量驱动，但**没有单一真源**。

若 overlay 只改一处，`derive()` 会把当前状态判成 `custom`（`index.ts:357-360`），`/permission` 显示 `Custom`。

### `DSH_PERMISSION_MODE` 的读取点（全在 cordis.yml 的 `!!js`）

| 文件:行 | 用途 |
| --- | --- |
| `bundle/base/cordis.patch.yml:246` | `sandbox-policy.mode` |
| `bundle/base/cordis.patch.yml:262` | `approval.policy` |
| `bundle/headless/cordis.patch.yml:31` | headless 覆盖 sandbox |

**没有 TypeScript 代码读它。** 语义是「进程级兜底默认，不影响已开 session」（`apps/cli/reference/README.md:131`）。

### `/permission` 切换链路

```
Browser → live.command('/permission <preset>')
  → permission-presets/src/index.ts:263-273
    → apply(session, name, policy => ctx.approval.setPolicy(agent, policy))
      ├─ session.append('permission/preset', { preset })   :416
      └─ updateKnobs()                                     :408-415
            ├─ setSandboxMode                             :410
            └─ setApproval → setPolicy                    :413
                  ├─ previous === policy → return          user-approval:213
                  ├─ setApprovalPolicy(session, policy)    :214  → append('approval/policy')
                  └─ agent.inject(切换通知)                :215-221
```

**`/permission` 只改调用它的那个 session**，其它 session 不变。

`agent.inject` **不唤醒** —— 切换通知在**下一个 step** 才被模型看到。

---

## 五、对清单的更新

| 项 | 更新 |
| --- | --- |
| **V-1** | **关闭**。`roots()` 存在且上游写法在现有全部路径上不误报；与宿主 `assertLiveRoot` 同模式 |
| 建议改进 | 若要更稳健，可改用 `delegationDepthOf(agent) > 0`（`@deepseek-ai/dsh-subagent` 已公开导出）或 `list().some(a => isOwnedBy(agent.id, a))`（零新依赖）。**但照抄上游也可接受**，因为与宿主一致 |
| P0-1' 实现补充 | `askToWrite` 里那句 `never` 判断的措辞必须区分「子任务」与「权限模式 never」，因为两者都返回 `rejected` 且无法从返回值区分 |
| 新增硬约束 | **后台定时器不能审批**，只能 `agent.followup()` 唤醒 turn。这对 `feed.start()` / `watch.start()` 将来做写操作是架构级限制 |
| 新增 | `displayReason` 重载后丢失 → 若我们要多语言提示，必须自己持久化 |
| 新增 | 三档映射在 `bundle/base` 是 YAML 配置，可被 profile override；但 `approval.policy` 与 `presets.*.approval` 无单一真源 |
