# 溯源结果 · 代理 3：preset 与 skill 机制

**来源**：子代理只读溯源 `.ref` + 本仓 preset/lecture、tool/study、profiles。

---

## 一、核心结论

1. **preset 不是「工具白名单」，是「一棵子插件树的 scope 挂载」**。`PresetDefinition` 只有 `id/name/description/order/plugins`，没有 allowlist、没有 model、没有系统提示字段。
2. **上游没有 `preset` patch 操作**。`architecture.md:25` 声称有，但实现里找不到，且 2026-09-21 决策笔记明确**否决**了该能力。
3. **本仓 `preset/lecture` 的做法符合标准机制**，这是官方路径。
4. **skill 扫描根不支持递归 `**/SKILL.md`**，frontmatter **没有 `allowed-tools`**。
5. **上游 `ctx.skills.registerProvider` 用法符合契约**，可直接照搬（三个可选改进点见第四节）。
6. **想让工具在所有 preset 可见**：挂到 host 平面（profile bundles），不要放进任何 preset 的 `plugins`。

---

## 二、preset 的两个包（能力缝三角）

| 包 | 角色 | 证据 |
| --- | --- | --- |
| `@deepseek-ai/dsh-agent-preset-registry` | Service Definition + Consumer，提供 `ctx.agentPresets` | `agent-preset-registry/src/index.ts:27-31,54,68` |
| `@deepseek-ai/dsh-agent-preset` | Provider / 声明行 | `agent-preset/src/index.ts:12-29` |

`register()` 返回 disposer；**激活失败不抛给启动**，写 `record.broken` + `logger.warn`，留在 roster（`index.ts:97-117,133-137`）。

### `PresetDefinition` 完整字段

```ts
// agent-preset-registry/src/definition.ts:5-11
export interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly (Omit<EntryOptions,'id'|'disabled'> & { id?: string; disabled?: ... })[]
}
```

**没有工具集、没有模型、没有系统提示。**

- **模型不在 preset 里**：来自 `agentDefaultModel` 与 session 的 model selection（`core/agent-default-model/src/index.ts:18-28`）。prompt 变量表**只有 `provider`/`model`**（`core/agent-loop/src/index.ts:337-338`）—— 这就是 `gen.mjs` 踩过 `{{cwd}}` 未注册那个坑的根因。
- **系统提示靠子插件行**：`@deepseek-ai/dsh-persona` 在 mount 的 scope 里 `systemPrompt.section()`（`preset/persona/src/index.ts:62-74`）。

---

## 三、**重大否证**：`architecture.md` 与实现不一致

`architecture.md:25`（中文版 `architecture.zh.md:25`）声称存在「`preset` patch 在目标声明的 `config.plugins` 内应用」。

**本 checkout 找不到实现**：

| 检查 | 结果 |
| --- | --- |
| `PatchOptions` 有 `preset` 字段吗 | **没有**（`vendor/include/src/patch.ts:5-16`） |
| `applyPatches` 处理什么 | 只有 `insert` / `id` + 任意 override key（`patch.ts:62-106`） |
| 全仓 grep `presetPatch\|applyPreset` | **零命中** |
| 决策笔记 | `.agents/notes/implemented/architecture/2026-09-21-...md:31` 把该操作列为**被否决的方案** |

**结论**：文档与实现不一致，且该能力已被决策否决。

**真正可用的「改某个 preset 的 plugins」手段只有一种**：`- id: preset-<id>` **整份覆盖 `config`**（`patch.ts:91-106`）。

→ 这条对融合很关键：**不能指望「只加一行工具进已有 preset」**，必须整份给 `config.plugins`。这也解释了为什么 `lecture` 的 composition 是 standard 的**整份逐行复制**。

---

## 四、本仓 `preset/lecture` 评估：**符合标准机制**

### 它用什么机制限定 3 个工具

声明式 preset + 子插件行 = scope 隔离，**不是 allowlist**：

| 环节 | 位置 |
| --- | --- |
| 声明 | `packages/preset/lecture/cordis.patch.yml:36-43`（`id: lecture`、`order: 5`、`plugins:`） |
| 唯一的独有行 | `:183-184`（`- id: tool-study / name: '@lybx-leyw/dsh-zju-tool-study'`） |
| bundle 发布 | `package.json:22-26` 的 `dsh.bundle.patch` |
| profile 注册 | `profiles/zju-workbench/package.json:36` |
| **工具包本身无挂载行** | `packages/tool/study/` 只有 `src/`，无 `cordis.patch.yml`；`package.json` 无 `dsh.bundle`；profile bundles 里 grep 零命中 |
| 只做注册 | `packages/tool/study/src/index.js:49-55`（`:53` 的 `ctx.effect(() => ctx.tools.register(tool))`） |

代理逐行比对过 lecture 与 shipped `standard.patch.yml`：**除末尾追加的 `tool-study` 两行外完全一致**（`Compare-Object` 只有这两行差异）。

### 两处偏差

| # | 事实 | 判定 |
| --- | --- | --- |
| 1 | composition 是 standard 的**整份复制** | **机制上必然**：`plugins` 是必填完整数组，无 `extends`/merge。风险是宿主升级后漂移，不是写法错误。已在 `gen.mjs:96-97`、`cordis.patch.yml:22-23` 记录 |
| 2 | patch 第一行插入「本包自己」（`:29-34`） | **非标准**。唯一作用是让 Loader `import()` 跑 `apply()`，而 `apply()` 只做一个**3 秒延时的 `console` 自检**（`src/index.js:27-53`）。无害但与 preset 正确性无关，且固定延时代替事件本身脆弱 |

### 一处表述不精确

`src/index.js:28-37` 与 `cordis.patch.yml:176-182` 的注释说「同一个包两边各挂一次 → 工具在表里注册两遍」。

**实际不会重复注册**：host 层 + preset 层是**两个不同 scope**，不会抛。真实后果是**可见范围失控**（global 注册对所有 preset 可见，preset 内同名注册覆盖它）。

→ 注释应改成「跨 scope 不会重复注册，但会让工具对全部 preset 可见」。

### `gen.mjs` 是干什么的

开发者侧一次性生成器，**非运行期**：

| 步骤 | 位置 |
| --- | --- |
| 入参：宿主当前版本 `presets/standard.patch.yml` 路径 | `gen.mjs:29-33` |
| 抽 `plugins:` 之后、缩进未归零前的子树 | `:48-63` |
| 归一到 10 空格缩进 | `:37-38,65-73` |
| 拼 header（写死 `id: lecture`/`order: 5`） | `:75-118` |
| 尾部追加 `tool-study` 行 | `:120-133` |
| 写 `cordis.patch.yml` | `:35,135-138` |

**只生成一个 YAML 文件，不生成 JS/JSON。**

---

## 五、skill 机制

### 扫描根与顺序（rank）

`skill-filesystem/src/index.ts:251-271`：

| rank | source | 根 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs`（按数组顺序） |
| 400 | `user-dsh` | `<dshHome>/skills`（跳过 `.system`） |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `bundledSkillDir` / `$DSH_BUNDLED_SKILL_DIR` |

- `projectRoot` = 最近的含 `.git` 的祖先（`:959-969`）→ 本仓就是仓库根
- **只认一层**：`<name>/SKILL.md` 或 `<name>.md`，**不递归**（`:740-747`）
- rank 只在**同一层内**比大小；跨层是「最近的 scope 层直接覆盖同名」（`skill/src/index.ts:551-565`）

### frontmatter 字段（`parseSkillFile`，`:828-853`）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（`:834-837`） |
| `description` | ✅ | 非空（`:830-833`） |
| `whenToUse` | — | `:848` |
| `metadata` | — | 任意对象（`:1053-1059`） |
| `disable-model-invocation` | — | true ⇒ `modelInvocable=false`（`:1014-1024`） |
| `user-invocable` | — | false ⇒ `userInvocable=false` |

**旧键被显式拒绝**并给迁移提示：`disableModelInvocation` / `modelInvocable` / `userInvocable`（`:1015-1017,1026-1031`）。

**`allowed-tools`：未找到。** 全仓 skill 包 grep 只命中 `liveshare` 的 fork 上限与 `subagent-claude-code` 的 `disallowedTools`（那是 Claude Code 子代理的 CLI 参数，与 skill frontmatter 无关）。

→ **宿主没有「skill 级工具白名单」这个能力。**

### 让 `docs/contributing/skills/` 生效的办法（按侵入度）

| # | 办法 | 依据 |
| --- | --- | --- |
| 1 | **`customSkillDirs` 指向它**（最省事，官方自己这么用） | `skill-filesystem/src/index.ts:58,80,260`；官方样例 `web-app/presets/cordis.patch.yml:124-128` |
| 2 | 搬到 `<repo>/.dsh/skills/`（rank 100）或 `.agents/skills/`（rank 200） | 本仓两者都不存在，需新建 |
| 3 | 运行期 `ctx.skills.register({...})` | `skill/src/index.ts:439-460` |
| 4 | 自定义 provider `ctx.skills.registerProvider(create)` | `skill/src/index.ts:390-428`，上游走这条 |
| 5 | bundled 根（rank 600，排最后） | `:71-72,174-176` |

**注意**：`docs/contributing/skills/README.md:3` 明写「这里不是任何 harness 的自动加载目录」。所以**要么改配置指过去，要么搬家，二者必须选一个**。

本仓现有两个 skill 的 frontmatter 都只有 `name` + `description`，符合解析要求。

### 上游 `registerProvider` 用法核实：**符合契约**

契约（`skill/src/index.ts`）：

```ts
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void   // :390
interface SkillProvider {
  readonly name: string
  readonly list: (o: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>  // :259
  readonly get: (c, o) => Promise<SkillDefinition | undefined> }                        // :266
interface SkillProviderControl { readonly signal: AbortSignal; readonly invalidate: () => void }  // :270-275
```

逐条核对 `plugin/host/index.mjs:147-154` + `:213-217`：

| 检查点 | 结论 |
| --- | --- |
| 同步返回值、三字段齐备 | ✅ |
| `list` 返回数组 = 「完整发现」简写 | ✅（`normalizeProviderObservation` 对 `Array.isArray` 直接 `complete:true`，`skill/src/index.ts:662-665`） |
| provider 名非保留值 `runtime` | ✅ `'zju-campus'` 合规（`:406-408`） |
| candidate 校验（kebab 名/非空 description/`invocation` 两布尔/`source` string/`rank` 有限数/`provider` 匹配） | ✅ 全满足（校验 `:707-739`） |
| `get` 用不透明 `locator` 回取 | ✅ `candidate.locator === SKILL_FILE` 是预期用法 |
| `control.invalidate()` 活性判定 | ✅ 赋值 `this.invalidate`，由 `activate(key)` 调（`host/index.mjs:163,168`） |
| `control.signal` | ⚠️ **未使用**。契约说注册销毁时 abort，上游既没监听也没传给 `list/get`。功能上不致命（registry 用 `waitWithAbort` 兜住，`:603`），但销毁后 in-flight 的 `list()` 不会被提前打断 |
| `list/get` 忽略 `cwd`/`signal`/`scope` | ⚠️ 允许，但意味着技能**不随工作区变化** |
| 异常面 | ⚠️ `skill()` 用 `readFileSync`（`:204`），SKILL.md 缺失时 `list()` 抛错 → registry 记 warning 标 `cacheable=false`，目录变「不完整」而不崩 |

**总判定：符合宿主契约，可照搬。** 建议补：(1) `list`/`get` 里 `options.signal?.throwIfAborted()` 起步；(2) 把 `control.signal` 的 abort 接到「下次 list 返回空」。

**结构性事实**：provider 注册进**哪个层**取决于插件挂在哪 —— 挂 profile（host 平面）进 global 层，**所有 preset 都看得见**；挂进 preset 的 `plugins` 就只进那个 preset 的层（`skill/src/index.ts:411-423` + `:551-565`）。

---

## 六、工具可见性决策链（权威版）

```
Agent.preStep
  └─ tools.resolve({agent, modelSelection, signal})        agent-loop/src/agent.ts:292
       └─ view(agent)                                      tools/src/index.ts:199-227
            ├─ 起点：global 层全部条目                       :202
            ├─ 叠加 scope 链上每层（farthest→nearest）       :203-206（store.ts:192-199）
            ├─ 限制：每层 restriction 都要 admits(name)      :214
            ├─ 例外：本 scope 自己的注册不过滤               :219-225
            └─ 权重：近者同名覆盖远者                        store.ts:213-215
       └─ 逐条 await registration.when(context)，false 剔除  :268-280
       └─ 返回冻结的 ResolvedToolSet                       :281-297
  └─ systemPrompt.assemble({... toolSet})                  agent.ts:294
       └─ executor.describe(this.definitions(scope, toolSet))
            └─ NativeToolExecutor.describe → projectToolSchema  tool-executor-native/src/index.ts:15-17
       └─ systemPrompt 收集 → orderTools(...)              system-prompt/src/index.ts:641-675
  └─ buildRequest(assembly.tools)                          agent.ts:656-691
```

### 三层不是「两层」

| 层 | 名字 | 何时生效 |
| --- | --- | --- |
| A | **注册落层**（preset 隔离的真身） | 插件 mount 那一刻，生命周期 = 该 fiber |
| B | **`restrict()` 名字遮罩** | 注册时编译，读时每层 `admits()` 求交 |
| C | **`when()` 每步准入** | 每 step 调一次 `resolve()`，reject ⇒ step preparation 失败 |

`restrict()` 的限制（`tools/src/index.ts:162-189`）：
- 只能遮**继承来的** global/祖先工具，**遮不掉本 scope 自己的注册**
- allow-list 会连带排除「以后新增的未列出工具」
- 要求 scoped ctx（`:163-166` 拒全局调用）

### 在所有 preset 可见的做法

**注册进 global（host）层**：工具包作为一行挂到 profile 平面，**不放进任何 preset 的 `plugins`**。

- 两条等价路径：(a) 工具包自带 `dsh.bundle.patch` 并列入 `dsh.profile.bundles`；(b) 直接写进 profile 的 `cordis.patch.yml`
- 官方同结论：`2026-09-21-...md:17`「optional model tools register in the global tool layer, so every preset, including minimal, receives them」
- **host 平面 id 陷阱**：web-app 把 base 的 `skill-filesystem`/`tool-skill` 等行按**行 id** 禁用（`bundle/web-app/cordis.patch.yml:521-525`），patch 按 id 命中（`patch.ts:91-95`）。自建行**必须换新 id**，否则会被上层 patch 覆盖成 disabled
- **代价**：`minimal` 只有 2 个工具行（`presets/minimal.patch.yml:11-23`），多塞 9 个会显著改变语义；`ptc` 会经 `run_code` 暴露成程序 API

---

## 七、对本仓的建议

### 9 个校园工具挂哪个 preset

**新建专用 preset（`campus`），按 `lecture` 同一套写法。**

包结构（与 lecture 同构）：
```
packages/preset/campus/
├── package.json          # dsh.bundle.patch: ./cordis.patch.yml
├── cordis.patch.yml      # - insert: preset-campus + config.plugins
└── src/index.js          # 可为空；建议不要复制 lecture 的 3 秒 console 自检
```

- `profiles/.../package.json` 只加 preset 包，**不加** 9 个 `packages/tool/*`
- 若希望工具**对所有会话默认可用**，则反过来：进程 profile bundles，**不再被任何 preset 挂第二次**。二选一，不要两边都挂
- **与 D11 一致**：先建工具包（不依赖 preset 决策），最后决定 preset 名单

### skill 放哪（三条路，按推荐度）

| # | 方案 | 优劣 |
| --- | --- | --- |
| **1（推荐）** | 移植成 provider 包，挂 host 平面：`packages/skill/zju-campus`，把 `SKILL.md` + `rows/*.md` 搬进来，`apply()` 里 `registerProvider` | 与上游行为一致（按行裁剪正文）、全局可见、无需用户复制文件。契约已核实通过。**注意 `resourceBase` 要指向随包发布的目录**，否则 `references/*.md` 相对引用失效（`skill/src/index.ts:193-198`） |
| 2 | 静态单文件 + `customSkillDirs` | 最省事，但失去「按开着的行裁剪」，且要包路径表达式（`!!js` + `baseUrl`） |
| 3 | 搬进 `.dsh/skills/` | rank 100 零配置，但把产品内容塞进用户工作区目录 |

**不推荐**放 `docs/contributing/skills/` 就完事 —— 该目录 README 明说不是自动加载目录，宿主确实不扫。

### 两个待办核对项

1. `preset/lecture/src/index.js` 的 3 秒自检可移除或改成事件驱动（`ctx.on('agent-preset/selected', ...)`）。现在它只证明「3 秒后 roster 里有 lecture」，对真实失败（如 `!!js` 行被上层 patch 改成 disabled）没有诊断力。
2. `cordis.patch.yml:176-182` 的注释应改成「跨 scope 不会重复注册，但会让工具对全部 preset 可见」。

---

## 八、对清单的影响

| 项 | 更新 |
| --- | --- |
| Q-E / D11 | **保持延迟**，但新增两条已定事实：①必须新建 preset，不能改已有（无 preset patch 能力）②工具包不加 profile bundles |
| Q-F / D12 | **保持延迟**，但**推荐方案已明确**：移植成 provider 包挂 host 平面 |
| 新增 | `allowed-tools` 不存在 → skill 无法约束自己能用哪些工具，只能靠正文说明 |
| 新增 | `customSkillDirs` 是官方推荐的外部目录接法（`web-app/presets/cordis.patch.yml:124-128` 有样例） |
| 新增 | 本仓 `preset/lecture` 的 3 秒自检是**非标准**，且无诊断力 |
| 新增 | `architecture.md:25` 的 preset patch 说法**与实现不一致且已否决** |
