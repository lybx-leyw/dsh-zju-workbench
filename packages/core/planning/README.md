# @lybx-leyw/dsh-zju-core-planning

规划域的**宿主半边**（core）：不含 UI。

## 两个入口，别混用

| 入口 | 含什么 | 谁用 |
| --- | --- | --- |
| `@lybx-leyw/dsh-zju-core-planning` | 全部：纯逻辑 **+ 文件存储 + 路由** | 宿主侧（profile 装配）与测试 |
| `@lybx-leyw/dsh-zju-core-planning/browser` | **只有纯函数，零 `node:` 依赖** | 页面的客户端半边 |

**客户端必须走 `/browser`。** 包入口同时导出 `schedule.js` / `ticks.js` /
`entries.js`（`node:fs` 与 `node:crypto`）；客户端若 import 裸入口，esbuild 会顺着
re-export 把 `node:` 内置模块打进浏览器产物 —— 构建往往还是绿的（只警告），
进页面当场白屏。`tests/page-isolation.test.mjs` 在盯这件事。

## 本包有什么

| 模块 | 职责 | IO |
| --- | --- | --- |
| `index.js` | **数据聚合**：四份来源并成一张表、`/_dsh/zhiyun-planning` 路由、快照、AI 规划、pet 对话 | 文件 + 网络 |
| `entries.js` | 中转站条目的内容指纹键（含旧口径迁移） | `node:crypto` |
| `plans.js` | AI 拆分：提示词、卡片校验、「源条目 → 卡片」映射 | 注入读写 |
| `time.js` | 上海时区口径、紧迫度、月历分格、日期对照表 | 无 |
| `agenda.js` | 任务键、墙钟换算、时段重叠、按周分组 | 无 |
| `local.js` | 「我的规划」：校验、重复规则、勾选/撤回 | 无 |
| `pet.js` | 对话协议：提示词、回包校验、流式解析器 | 无 |
| `pet-context.js` | 给模型的确定性事实（哪些已排/未排） | 无 |
| `pet-stream.js` | SSE 消费 | 网络（注入） |
| `schedule-hint.js` | 「这天有几节课」 | 无 |
| `error.js` | 把 `{ code, message }` 翻成一句人话 | 无 |
| `focus.js` | 「停在这一条」的读写 | storage 注入 |
| `schedule.js` | 执行时间块的存储 | 文件 |
| `ticks.js` | 平台待办的本机勾选 | 文件 |

## 为什么整块搬到这里

它们原先全部住在 `packages/client/page-planning/src/`，而那一页**同时是服务器**：
2068 行的 `index.js` 管着中转站拉取、快照、待办聚合、AI 规划、pet 对话与路由。

按本仓分层（page 只做 UI，core 管数据与宿主服务），这整块不属于页面。搬迁后：

- 页面 `src/index.js` 只剩一个空 `apply()`（保留是为了让客户端 bundle 进启动图谱）；
- **停用页面不再等于停用这套数据**（脚本、将来的 tool 都能直接调 `zhiyunPlanning`）；
- `tests/page-isolation.test.mjs` 的「页面不许碰 `node:fs`」终于全绿。

## 装配

`cordis.patch.yml` 只登记一行 `zhiyun-planning`；`apply()` 自己把存储、索引与
路由一起挂起来，并在 `ctx.provide('zhiyunPlanning')` 上暴露只读面。

## 验证

```bash
node --test tests/planning-*.test.mjs tests/campus-planning-contract.test.mjs
node --test tests/page-isolation.test.mjs   # 客户端不许 import 裸入口
```
