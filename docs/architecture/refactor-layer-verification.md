# 会话诊断记录（供后续 agent / 维护者）

## 环境：本会话无法执行任何命令

| 事实 | 证据 |
| --- | --- |
| 主 agent 的工具集里**没有**命令执行工具 | 调用 `bash` / `ops_bash` / `ops_exec` 一律返回 `Error: unknown tool "…"` |
| 即便有，`npm run build` 也会 `spawn EPERM` | 子 agent 用 `pwsh` 实跑：`node scripts/build.mjs` → exit 1，`spawn EPERM` 于 `scripts/build.mjs:204`（esbuild 的 `await build({...})`） |
| 根因是沙箱，不是仓库 | 对照实验：`spawnSync(execPath, ['-v'], { stdio: 'pipe' })` → `EPERM`；同一调用 `{ stdio: 'inherit' }` → `status: 0`。DSH workspace-write 禁止开命名管道，而 esbuild 的 JS API 用管道 stdio 启原生二进制 |
| 依赖树健康 | `npm ls --depth=0` exit 0，`esbuild@0.25.12` 等直接依赖都在；`extraneous` 全是 workspace 链接 |

**结论**：任何依赖 esbuild 的构建（`npm run build`）在本会话内都不可能成功，改代码也无效。
需要在沙箱外由用户执行。

---

## 本轮分层重构做了什么（截至第 17 轮）

### 四条规则（静态核验全绿，但**未经构建/测试验证**）

| 规则 | 核验命令 | 结果 |
| --- | --- | --- |
| core 不含 UI | `grep "from 'react'" packages/core` | 0 命中 |
| page 只含 UI | `grep "node:fs\|node:crypto" packages/client` | 0 命中 |
| 页面零交互 | `grep "from '@lybx-leyw/dsh-zju-page-" packages/client` | 0 命中（仅注释） |
| source 收错误 | `translateXzzdError` 在 campus 且接入 `todos()` 返回 | ✅ |
| tool 不注入 preset | `packages/tool/study` 无 `dsh.bundle` | ✅ |

### 搬迁清单

| 从 | 到 | 内容 |
| --- | --- | --- |
| `core/classroom-renderer` | `client/ui-shared` | `ClassroomSlide` + 样式（core 只留两个画布常量） |
| `client/page-notes/src` | `core/vault` | 存储半边（900 行）+ PDF 路由（427 行） |
| `client/page-planning/src` | `core/planning` | 全部 11 个模块 + 2068 行宿主半边 |
| `client/page-plugins/src` | `core/plugin-graph` | `runtime.js`（413 行纯函数）+ 只读路由 |
| `client/page-planning` 的 `zhiyun-pta` 分区 | `source/campus` 已有分区 | 删除页面重复的凭据入口 |
| `packages/tool/study` 的 patch | `preset/lecture` 的 plugins 树 | 工具只注册、注入点唯一 |

### 未完成 / 需人工处理

1. **15 个旧副本**（`page-planning/src` 13 个 + `page-plugins/src` 2 个）已降级为再导出，
   待删除。命令见 `page-planning/src/time.js` 文件头（PowerShell 的 `-Path @(...)` 数组语法）。
2. **构建与测试从未运行过**。`core/planning/src/index.js` 是 2048 行整体重写，
   正确性目前只由静态阅读保证 —— 这是本次重构最大的未验证风险。
3. `source/classroom/src/errors.js` 与 `source/http/src/errors.js` 逐字重复
   （进程里有两个 `ClassroomError` 构造函数），已在文件头记录，未改。

---

## 建议的验证顺序（沙箱外）

```bash
npm run build
node --test tests/core-no-ui.test.mjs tests/page-isolation.test.mjs \
  tests/source-error-contract.test.mjs tests/build-seeds.test.mjs
node --test tests/planning-*.test.mjs tests/plugins-page.test.mjs \
  tests/vault-notes.test.mjs tests/pdf-import.test.mjs
```

`npm run build` 最可能暴露问题的地方：`packages/core/planning/src/index.js`。
