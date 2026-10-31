# dsh-radar-skill-stats —— 候选骨架

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
| 主仓库 | [chen-zz20/dsh-skill-stats](https://github.com/chen-zz20/dsh-skill-stats)（README 指明 star / issue 请到主仓库） |
| 本轮扫到的 | [omdsh-dev/dsh-skill-stats](https://github.com/omdsh-dev/dsh-skill-stats) —— **只读社区镜像** |
| npm | `@dsh-external/dsh-skill-stats@0.1.0` —— ⚠ **`private: true`** |
| 许可证 | **MIT** ✅（仓库 `package.json` 的 `license` 与 GitHub API `spdx_id` 一致） |
| Stars | ★1（镜像；主仓库星数未计，镜像不承载社区反馈） |
| 最近推送 | 2026-08-16 |
| 语言 | TypeScript（`tsdown` 打包，ESM） |
| 挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.inject: ['@deepseek-ai/dsh-client-runtime']`，`platform: web` |
| 运行时依赖 | `@deepseek-ai/dsh-home-paths: ^0.1.0-rc.6`（**rc 段上的 `^`**） |

### 上游做什么

> 统计每个技能被 `skill` 工具调用的次数（历史回放 + 实时订阅），帮助判断哪些技能值得保留。
> **只读插件**，不修改任何会话日志或技能文件。

- 历史回放：启动时扫描 `session.jsonl` / `session.jsonl.zstd`，解析 `tool/call` 事件；
- 实时订阅：监听进行中的工具调用事件即时累加；
- 增量缓存：按文件大小与 mtime，重启只重放变化过的日志；
- 已删除标记：技能目录不再存在于任何工作区或全局技能根时标「已删除」；
- 加载态：重放未完成时显示加载提示，**不把统计中的空快照误报为「未使用」**。

接口：`GET /skill-stats/api/stats`（全量）、`?scope=current`（仅在磁盘上的）、`?sessionId=…`（单会话）。

---

## 定性：**强化式集成**（不是全新面板）

### 本仓要替换的那条底层，先摆事实

`packages/dsh-zhiyun-page-plugins/src/usage.js` 里已有一套「吃灰」账本：
`createLedger / recordUse / staleness / summarize`，`Panel.jsx:147` 已经把它渲染成清单。
**但它的数据源是空的**：

```
$ grep -rn "recordUse" packages/ scripts/ tests/ | grep -v packages/radar/
packages/dsh-zhiyun-page-plugins/src/usage.js:53:export function recordUse(...)   ← 定义
tests/plugin-usage.test.mjs:11,16,19,25,27,28,34,36                                 ← 只有测试在调
```

- **`recordUse()` 在生产代码里零调用点**；
- `USAGE_KEY = 'zhiyun-plugin-usage-v1'` 这个 localStorage 键**没有任何写入方**（`Panel.jsx` 只读）；
- 于是 `summarize()` 的 `known` 循环把所有条目都填成 `count: 0` → **线上恒为全是 `never`**。

也就是说：**这是一个已经存在、但永远只会说「全部都没用过」的面板。**
（该账本本身是能力提取自 `dsh-radar-knowledge-graph` 的产物，见 `usage.js` 顶部注释。）

### 三判据逐条对齐

| 判据 | 本包 |
| --- | --- |
| ① 仍是同一个面板 | ✅ 不新增导航 / 路由 / 开关。改的是 `Panel.jsx` 里**已有**那列「吃灰清单」背后的一份数 |
| ② 功能仍相似正交 | ✅ 仍是「这一项值不值得留」，仍是 `never / stale / active` 三态判定，`summarize()` 的入参出参形状不变 |
| ③ 底层多调了更优质实现 | ✅ 本仓**没有**会话日志回放这一层：`grep -rniE "session\.jsonl\|tool/call\|invocations" packages/`（排除 `packages/radar/`）= **0 命中**；上游有回放 + 实时 + 增量缓存 + 已删除 + 加载态五件套 |

> **与「加一个统计页」的区别**：上游自带的侧栏页（会话视图、全局面板、SVG 趋势图、
> 1/3/7/30 天筛选条）在本包里**一律不挂**。挂上去就是「重复无增益」的第 N+1 家用量面板
> —— registry 里该轴已于 2026-10-19 判饱和（`用量统计簇`，13 家）。

---

## 评审必须先回答的四个问题

1. **`private: true` 的包怎么「锁版引入」？**
   上游不在公共 npm 上（`private: true`）。本包 `dependencies` 里写的 `0.1.0` 是**形状占位**，
   实际只能 `link:` 本地 checkout 或从 git URL 装。**若评审不接受「锁版必须来自 registry」之外的来源，本骨架作废。**
2. **`@deepseek-ai/dsh-home-paths@^0.1.0-rc.6` 这条 `^` 要不要一起锁？**
   `^0.1.0-rc.6` 允许进 `0.1.x` 后续 rc **与正式版**。宿主若在用别的 rc，同一条计数会来自
   两个不同版本的路径解析。→ 引入时必须把这条依赖锁到**宿主在用的那个 rc**，否则 `README` 里的
   「锁版」只是字面锁版。
3. **同一个数字有两个写者怎么办？**
   落地后 `skill:` 这一段的真源是上游，`tool:` / `plugin:` 仍归本仓账本。`recordUse()` 是否保留
   （并改成只写后两类）需要拍板；**不能两边都写同一个 key**。
4. **会话日志是行为数据，能读到什么程度？**
   本包只要 `name / invocations / lastUsedAt`，**不落盘 `callTimes[]`**、不上传。
   若评审认为「扫描本地会话日志」本身超出了本工作台的隐私边界 → 本骨架作废。

---

## 明确不做

- 不做上游的侧栏页、趋势图、时间范围筛选条；
- 不解析 `session.jsonl.zstd`（解压依赖不在本包，且那是上游的活）；
- 不改 `summarize()` 的三态判定与排序；
- **不写测试**（skill 硬边界：radar 包内不得有 `test/` / `*.test.*`）。

---

## 目录

```
packages/radar/dsh-radar-skill-stats/
├── package.json         # 锁版 @dsh-external/dsh-skill-stats@0.1.0；dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml     # insert: radar-skill-stats（骨架阶段指向本包占位入口）
├── src/index.js         # 占位 + TODO-A / TODO-B；apply() 抛错
├── src/upstream.js      # 上游形状与坑的唯一引用点；TODO-C / TODO-D
├── README.md
└── OWNERS               # Owner: shared
```
