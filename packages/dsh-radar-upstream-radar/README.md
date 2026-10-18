# dsh-radar-upstream-radar —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [MicroMilo/upstream-radar](https://github.com/MicroMilo/upstream-radar) |
| npm | `upstream-radar@0.45.0` |
| 许可证 | **Apache-2.0** ✅（宽松白名单内；**三源一致已核**：GitHub API / 根 `LICENSE` / npm `license`） |
| 作者 | MicroMilo |
| Stars | ★11（fork 0） |
| 建仓 / 最近推送 | 2026-08-14 / 2026-10-16（**活跃**） |
| 语言 | TypeScript（`engines.node >= 22`） |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` —— **标准 bundle 形状**；**无 `dsh.client`** |
| 上游 patch 行 | `id: upstream-radar`，`name: 'upstream-radar/dsh'` |
| 运行时依赖 | **零**（`dependencies: {}`） |
| Cordis 注入 | `inject: ['agents']` |

### 上游做什么

> *Know which DeepSeek Harness plugins still work — before users find out they do not.*

盯住 DSH 与插件的**精确版本**；输入一变就起 Agent：读仓库证据（README / manifest /
lockfile / CI / 启动脚本）→ 自选 Node 与执行 profile → 在**一次性 CI** 里
**真装真跑** → 边跑边读增量日志、处理可恢复的构建门禁 → 产出**绑定证据**的兼容性报告。
每条报告绑定插件字节、源码 commit、DSH 版本、Node 版本、profile、命令与日志。

上游自己明确反对三件事，本包沿用同一口径：

- 不猜矩阵（*no guessed matrix*）；
- 不把「装成功了」当「兼容」（*no “install succeeded, therefore compatible”*）；
- 不静默未知（*no silent unknowns*）—— **`completed` 只表示分析结束，不表示通过**。

---

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch`，npm 可锁版）
- **集成方式**：**强化式集成** —— 锁版挂载 + 宿主侧读上游报告 + 页面侧追加一列，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ **「插件」页**，同一张依赖图、同一行，只加一列。**上游没有 `dsh.client`** —— 结构上就不存在「另挂一块面板」的可能。这条判据在本包里是**由包形态保证的**，不依赖实现自律 |
| 功能仍相似正交 | ✅ 同一批插件、同一个判断（「它对我的工作台意味着什么」）。现有讲**横向**（谁依赖谁、现在能关掉谁），本候选讲**纵向**（下次启动还能不能被加载） |
| 底层多调了更优质实现 | ✅ 本仓**没有**「隔离环境里真装真跑」这条证据链：需要一次性运行器、Node/profile 选择、增量日志读取、可恢复构建门禁、去重与重试。这是独立的一整类基础设施 |

---

## ⚠ 与 `dsh-radar-compat-vet` 的关系（评审必看）

两者**抢同一列的同一行**，但**取证层不同**，因此**不是简单集成重复功能**：

| | `dsh-radar-compat-vet`（10-17 出） | 本包（10-18 出） |
| --- | --- | --- |
| 上游 | `dsh-compat-vet@0.3.2`（MIT） | `upstream-radar@0.45.0`（Apache-2.0） |
| 取证方式 | **静态契约比对**：读 `dsh.engines.framework` / peer 范围 / 已知破坏表 | **动态隔离实跑**：真的装起来跑一次，读日志判定 |
| 类比 | 体检报告（看指标） | 实车碰撞测试（真撞一次） |
| 成本 | 打开页面即出，近乎零 | 起 Agent + 开环境，**分钟级** |
| 结论强度 | 「将要越界」的**预警** | 「装不进 / 起不来」的**硬证据** |
| 自带 client | ❌ 有（骨架刻意不启用） | ✅ **本身就没有** |
| 未知态 | 有（探测失败） | **必须有**（未测 / 离线 / Agent 不可用 / 证据不完整 / 结论过期） |

**结论**：二者输出同构（插件 × DSH 版本 × Node 版本 → 可加载 / 不可加载 / 未知），
**应当汇入同一列**，用 `source: 'static' | 'isolated-run'` 区分，
而不是做成两列、更不是做成两个面板。

> **但本轮不改动 `compat-vet` 骨架**。两个骨架同时 `proposed` 且抢同一列，
> 是评审者需要**先裁决**的事（见「人工裁定事项」第 1 条）。
> **在裁决前，两者都不得接入 profile。**

---

## 增强哪个现有功能

`packages/dsh-zhiyun-page-plugins`（「插件」页）。

该页当前**只回答「我现在能不能关掉它」**：`src/runtime.js` 计算
`deps` / `dependents` / `leaf` / `cancellable` / `readOnlyReason`，
`src/Panel.jsx` 只渲染状态点、叶/下游/已取消/不可更改徽标与开关。
**全文无 peer / semver / engines 相关实现**（已 grep 核实；本轮与 10-17 两轮独立复核结论一致）；
`packages/` 下也**无任何 compat 命名包**。

接上游后，**同一页面、同一行**上补出另一半信息：
**这个插件下次启动还能不能被加载**，以及**这个结论有没有证据**。

---

## 需要人工裁定的事项

1. **⚠ 与 `dsh-radar-compat-vet` 抢同一列** —— 见上一节。
   建议顺序：**先评审 compat-vet 定「列的形状」**（更轻、无 Agent 依赖、打开页面零成本），
   再决定是否把本包作为**该列的第二取证源**。
   **两者只能有一个先进 UI。**

2. **⚠ 运行时成本与本仓场景的冲突（本轮最大未知项）** ——
   上游 `inject: ['agents']`，本质是**在宿主里起 Agent 开一次性环境**。对本仓意味着：
   - 这不是「打开页面就出结果」，而是**异步、分钟级、可能失败**；
   - 学生日常使用、可能离线（课堂 / 宿舍网络）→ **必须优雅降级为 `unknown`**，不能报错、不能空白；
   - 上游自己的口径是 *completed ≠ passed*，本仓文案**不得**把「分析完成」渲染成「兼容」。

   **评审时请优先确认：无 Agent 配额 / 离线时，页面是否仍能正常渲染并显示 `unknown`。**

3. **`engines.node >= 22` 硬门槛** —— 本仓 `runtime.lock.json` 与 CI 的 Node 版本需核对。
   若低于 22，锁版安装直接失败。**这是采用前第一件要验的事。**

4. **挂载子路径** —— 上游 `exports` 把 `.`（CLI 库）与 `./dsh`（插件）分开，
   `cordis.patch.yml` 必须写 `upstream-radar/dsh`。挂成裸包名会拿到 CLI 库而不是插件。

5. **不代理任何写动作** —— 本包只**读**上游产出的报告。
   不触发安装/卸载/升级，不写 profile，不绕过本仓既有的行级开关
   （`remote.pluginManager.setPluginEnabled`：写用户 overlay、`initialize()` 保留、共享宿主只读保护）。

6. **结论的新鲜度** —— 上游报告绑定 DSH 版本与插件字节。任一变化，旧结论必须降为 `stale`，
   **不能继续显示为 `passed`**。否则这个列会变成「看起来有证据的假保证」。

---

## 未接入声明

- ❌ **未**写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`
- ❌ 未在真实环境挂载
- ❌ 未落实任何业务逻辑（`src/index.js` 为空实现，`readCompatProfile()` 直接抛错）
- ❌ 未代理上游任何写入口
- ❌ 未提供测试（锁版一致性测试在 TODO 里）

## 许可与署名

上游 Apache-2.0，本骨架仅**锁版引用**，**未摘取任何源码**。
若后续确有代码借鉴（例如归一化/格式化逻辑），按 `CONTRIBUTING.md` 3.3 在 `ATTRIBUTION.md` 登记。
