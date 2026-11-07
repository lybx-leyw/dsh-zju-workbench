# dsh-radar-prompt-shelf

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply` 是空实现、`src/upstream.js` 的
> `loadUpstream()` **恒返回失败** —— 这是故意的，不是没写完。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`yi-yezhiqiu/dsh-prompt-market`](https://github.com/yi-yezhiqiu/dsh-prompt-market) |
| npm | **`dsh-prompt-market@0.1.3`**（⚠ 包名与仓库名一致，可直接 `npm view` 核实） |
| 许可证 | **MIT** ✅（npm `license` 字段与仓库根 `LICENSE` 两处一致） |
| Stars | ★109（2026-10-15 首登记录时为 ★76） |
| 最近推送 | 2026-10-11（**已约 3 周未动**，故列为「可锁版」而非「活跃」） |
| 语言 / 形态 | JavaScript（纯 ESM，**无构建步骤**，`files` 直接发源码） |
| 运行时依赖 | **无**（`dependencies: []`、`peerDependencies` 未声明） |
| 挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml`（一行 `insert`）+ `dsh.client.platform: web` |
| 注册槽位 | `conversation.input.left`（按钮，order 80）· `conversation.input.overlay`（浮层，order 80） |
| 数据落点 | 自管 localStorage（`favorites` / `customs` / `tags`） |
| 首次发现 | 2026-10-15（当时并入「插件市场簇」整批封板，**未单独评估能力**；2026-11-02 重新过判据） |

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch` + `dsh.client`）—— 最高优先
- **集成方式**：**锁版挂载 + 外围兼容层**（绝不改上游源码）
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| # | 判据 | 本候选 | 结论 |
| --- | --- | --- | --- |
| ① | 仍是同一个面板 | 入口只占 `conversation.input.left` / `conversation.input.overlay` —— **对话输入框本身**，不新增导航项、不开独立页 | ✅（已 grep 本仓：这两个槽位**当前无人占用**） |
| ② | 功能仍相似正交 | 「输入框里**写什么**」vs「**写过的好指令怎么复用**」—— 同属输入区，但一个是创作、一个是检索复用 | ✅ |
| ③ | 底层多调了更优质实现 | 本仓目前**没有任何**用户侧提示词存储 / 检索 / 插入通路（详见下节） | ✅ |

### 判据③的核实过程（不是看 README，是 grep 出来的）

| 检索 | 结果 | 判断 |
| --- | --- | --- |
| `grep -rniE "prompt ?(template\|library\|preset\|注入\|库)\|/prompt\b" packages/dsh-zhiyun-*/src` | 命中项全部是**出题流水线**的内部文案：`core-classroom-generate/src/prompts.js`（课程上下文模板）、`core-lecture-tools/src/prompt-hints.js`（工具描述拼装）、`core-question/src/i18n.js`（上游 Python 对位注释） | **与用户提示词无关**，只是词面相同 |
| `grep -rhoE "conversation\.input\.[a-z]+" packages/dsh-zhiyun-*/src` | **0 命中** | 输入区**完全没有**被本仓占用 |
| `ls packages/radar/*prompt*` | 无 | 没有同域骨架 |

⇒ 「用户提示词」这一层在本仓是**真空**，不是「已经有了想做更好」。这是判据③成立的**唯一**依据；
如果评审发现我漏看了某处实现，判据③立即不成立，本骨架应作废。

## 为什么选它，而不选 `FeatherHunter/dsh-prompt`

同域有两个候选，**必须二选一，不要并列接入**（并列＝两枚按钮抢同一个槽位）。

| 项 | **`dsh-prompt-market`（本骨架）** | `FeatherHunter/dsh-prompt` |
| --- | --- | --- |
| Stars | ★109 | **★92** |
| 最近推送 | 2026-10-11 | **2026-11-01（活跃）** |
| 版本 | `0.1.3` | `0.4.40`（40+ 版本迭代） |
| 运行时依赖 | **无** | `zod@^4.5.4` + `dsh-log@^0.3.4`（**私有包、非锁版**） |
| 安装期构建 | **无** | `prepare: npm run build`（**装包即构建**） |
| 浏览器半身体积 | 约 200 KB 量级 | `lib/client.js` **1,017,637 B ≈ 1.0 MB** |
| 功能 | 浏览 / 搜索 / 收藏 / 自定义 / 插入 | 预制 + 自定义模板 / `/prompt` 联想 / 悬浮卡 |
| 对外出口 | `globalThis.__pmCore`（隐式契约） | `globalThis.__dshPromptSetRemote`（**只管 UI 偏好，与提示词无关**） |

**取 `prompt-market` 的唯一硬理由是可锁版**：零依赖、零构建、单版本 —— 这三条对本仓是硬门槛
（历史教训见「迁移后构建异常」与多处「`prepare` 现场构建 → 锁版成本高」的拒绝记录）。
`dsh-prompt` 的 `prepare` + 私有 `dsh-log` 意味着「锁版」实际上锁不住构建产物。

**但必须说清楚**：`dsh-prompt` 在**功能与成熟度上明显更强**。如果评审认为
「本仓 = 一个教学/学习工作台，学生没有那么多高频重复 prompt」，
那么正确结论是**这条轴整个不做**，而不是换一个更弱的上游硬做。见 `src/index.js` 的 Q1。

## 接入前必须先做的事（按顺序）

1. **确认「纯本机模式」是否可行**（`src/upstream.js` 的 `localOnlySupport()`，现返回 `supported: false`）
   —— 上游 `core/sources.js` 默认拉远端目录，且带 `api.github.com` base64 兜底。
   如果只能连着外站目录用，那么在一个**校园内网 / 弱网**场景里，这个面板会经常处于错误态。
   **这一条不解决，本包不值得继续写。**
2. **确认配置通道**：上游 `cordis.patch.yml` 写 `config: {}`，而 `index.js` 的 `apply` 是空的 ——
   配置到底从哪读（settings 键还是 config 行）尚未核实。
3. **确认槽位独占**：本仓现在没人占 `conversation.input.left`。要搞清楚是「没人做」还是
   「宿主不给用」—— 若是后者，本骨架整体作废。
4. **数据归属决定**（`src/index.js` 的 Q2）：先保持上游自管 localStorage，
   只做「导出 → 备注页」单向通路，不做双写。

## 目录

```
packages/radar/dsh-radar-prompt-shelf/
├── package.json     # dependencies: dsh-prompt-market 0.1.3（精确版本，无 ^）
├── cordis.patch.yml # - insert: [{ id: radar-prompt-shelf, name: dsh-radar-prompt-shelf }]
├── src/index.js     # Host 半身占位 + 5 条 TODO
├── src/upstream.js  # 上游形状记录 + loadUpstream() 恒失败占位
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

无 `ATTRIBUTION.md`：本骨架**未摘取上游任何代码**，只记录形状与结论。

## 与仓库规则的一致性

- [x] 位于 `packages/radar/` 下（不在 `packages/` 根）
- [x] 未写入 `profiles/zhiyun-bench/package.json`
- [x] 无 `test/` / `__tests__/` / `*.test.*` / `*.spec.*`
- [x] A 类锁版：`dsh-prompt-market: "0.1.3"`（无 `^`）
- [x] 许可证宽松白名单内（MIT），无摘码
- [x] `OWNERS` 为 `Owner: shared`
