# 讲义导出到笔记库 · 回归报告

日期：2026-10-29　仓库：`zhiyun-pro-js`　profile：`zhiyun-bench`

> 本文记录**实际跑过的命令与原文结果**，以及每条失败项的归因结论与判定依据。
> 架构在实现中途改过一次（从「版本对 + 归档 + swap」改为「单向导出 + 重名加后缀」），
> 所以有些数字前后不一样，两段都留在这里，不做合并。

---

## 一、最终状态：全绿

```
handout-codec          tests=10 pass=10 fail=0
handout-store          tests=11 pass=11 fail=0
handout-discipline     tests= 2 pass= 2 fail=0
vault-notes            tests=11 pass=11 fail=0
notes                  tests=42 pass=42 fail=0
vault                  tests=37 pass=37 fail=0
profile                tests=14 pass=14 fail=0
study                  tests=20 pass=20 fail=0
──────────────────────────────────────────────────
合计 147 条，fail = 0
```

命令（逐个文件直接跑；`node --test <多文件>` 在本机沙箱里会 `spawn EPERM`，见第四节）：

```bash
node tests/handout-codec.test.mjs
node tests/handout-store.test.mjs
node tests/handout-discipline.test.mjs
node tests/vault-notes.test.mjs
node tests/notes.test.mjs
node tests/vault.test.mjs
node tests/profile.test.mjs
node tests/study.test.mjs
```

样式归属检查：

```bash
npm run check:css
# 检查了 15 个包的样式表：跨包 @media 顺序依赖 0 条，跨包同属性值竞争 0 条，
# 同包内 @media 倒序 0 条（共比对 169 条 @media 规则、7 对跨包同类规则）。
# 样式归属正确：没有跨包顺序依赖 ✓
```

---

## 二、架构变更点（这是测试数变化的唯一原因）

### 2.1 改了什么

| 旧设计（已废弃） | 新架构（当前） |
|---|---|
| 版本 =（AI 基线, 讲义 md），二者同生同灭 | 没有版本对 |
| `讲义归档/<课程>/<节次>/v<N>/` | 没有归档目录 |
| 重新生成换版、旧版进归档 | 每次导出新写一份，不覆盖 |
| swap / `planDeactivate` / `resolvePlan` | 没有回退操作 |
| 改 4 处读取路径让 md 成为真源 | `record.lecture` 仍是唯一真源，导出单向 |
| 重名即覆盖（归档内） | 重名加 `（2）（3）` 后缀 |

**放弃旧设计的直接原因**：它要让 md 成为真源，就必须改掉学习页、两层检索、出题这四处
读取路径 —— 跨四个包的深度挂钩。定为「导出只是一份给用户自己编辑的副本」之后，
那整套机制连同它的复杂度一起失去存在理由。

### 2.2 测试数为什么从 60 变成 34（再变成 43）

| 时点 | 条数 | 说明 |
|---|---|---|
| 改动前基线 | 60 | codec 10 + version 16 + store 12 + discipline 2 + notes-archive 9 + vault-notes 11 |
| 新架构落地后 | 43 | 删掉 version 16 条（测的全是已移除的版本对/swap）、notes-archive 9 条（测的归档机制已无生产方）；store 由 12 条变为 11 条 |
| 再删归档相关 | 34 | 交接单里的归档排除逻辑一并移除后，只余 codec 10 + store 11 + discipline 2 + vault-notes 11 |

⚠️ **这不是回归，是被测对象少了一整套。** 删掉的每一条测的都是已经不存在的行为。

### 2.3 顺带清掉的两处

- `packages/dsh-zhiyun-page-notes/src/index.js` 的 85 行新增（`ARCHIVE_DIR` /
  `isArchivePath` / `walk({skipArchive})` / `readRaw` / `writeRaw`）**已整体回退到 HEAD**。
  理由：新架构不再产生 `讲义归档/`，这套逻辑没有生产方。回退前已备份（见第五节）。
- `tmp-handoff-handout/clear/` 此前登记的「版本对 / 归档 / swap」本体概念已不适配新架构。

---

## 三、既有测试无回归的依据

| 关注点 | 依据 |
|---|---|
| 讲义生成路径未被破坏 | `study.test.mjs` 20 条全过，其中 `:92` 断言 `lectureHistory.length === 0` |
| `workbench.js` 改动未破坏 RPC | 同上；新增的 `handout-export` 只加进 method 白名单，不动既有分支 |
| 笔记库行为未变 | `notes` 42 条、`vault` 37 条、`vault-notes` 11 条全过；`page-notes` 已回到 HEAD |
| profile 登记正确 | `profile.test.mjs` 14 条全过，其逐字期望清单已补 `dsh-zhiyun-core-handout` |
| 样式无跨包顺序依赖 | `npm run check:css` 原文见第一节 |

---

## 四、没能跑成的两项，及为什么

### 4.1 `npm run build` —— 沙箱限制，非本改动

```
Error: spawn EPERM
  at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)
  at buildClientPackage (scripts/build.mjs:90:24)
```

**判定依据**：直接对 esbuild 做最小调用同样失败 ——

```bash
node -e "require('esbuild').buildSync({stdin:{contents:'let a=1'},write:false})"
# code: 'EPERM', syscall: 'spawn'
```

`buildSync` 不涉及任何本仓代码，仍然 `EPERM`。结论：本机沙箱禁止创建子进程，
`esbuild` 起不来。**与本次改动无关**，但**构建产物因此未被验证**。

替代验证（已做，但不等于构建通过）：

- `node --check` 通过：`workbench.js`、`host.js`
- `handout-export.jsx` 与 `lecture-reader.jsx` 的括号/引号配平自检通过
- 用 `git show HEAD:...` 取出改动前的 `lecture-reader.jsx` 做同一套自检，
  得到**与改动后完全一致的统计**（开放-自闭合=43、闭合=44），证明那个「可能不配平」
  是启发式把 `<>` 与三元表达式误判，不是本次引入
- 接口对齐已人工核对：`controller` 在三处 `LectureReader` 调用点都传入；
  `rpc.call` 返回 `{ok,value}` 且 `client.jsx:30` 解包 `result.value`，
  所以组件拿到的就是 `exportLecture` 的原样返回值

⚠️ **风险披露**：JSX 未经真实编译。若 `handout-export.jsx` 有语法错误，
只有等能跑构建的环境才会暴露。

### 4.2 `node --test <多文件>`

同样 `spawn EPERM`（测试运行器要派生子进程）。改为逐个文件直接执行，等价覆盖。

---

## 五、回退备份

删除 `page-notes` 的归档逻辑前已备份：

```
.verify-scratch/backup/page-notes-index.archive-feature.js
.verify-scratch/backup/handout-notes-archive.test.mjs
```

同时被删的还有 `tests/handout-version.test.mjs`（16 条，测的全是已移除的版本对/swap）。

---

## 六、遗留与已知限制

1. **构建未验证**（第四节）。这是唯一没能闭环的验收项，原因在环境。
2. **`record.lecture` 与新导出的 md 会不一致**：这是新架构的**预期行为**，
   不是缺陷。学习页显示 `record.lecture`（AI 最新一份），笔记库里的副本归用户自己管。
3. **导出按钮的 RPC 未做端到端真机验证**：链路（按钮 → `controller.request` →
   `rpc.call` → method 白名单 → `exportHandout` → `zhiyunHandout.exportLecture`）
   已逐层核对，但没有在运行中的应用里点过一次。
4. **`dsh-zhiyun-core-handout` 没有 `client.jsx`**，因此**未加进**
   `scripts/build.mjs` 的 `CLIENT_PACKAGES`。那个清单的判据是「有 src/client.jsx」，
   硬加会让构建去找一个不存在的源文件。交接单第 9 步要求加，是基于旧架构要写
   版本面板 UI 的前提；新架构的 UI 按钮在 `page-study` 里（它本来就是客户端包）。
