# dsh-radar-pta-progress —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` **只有占位与 TODO**，
> `classifySubmissionState()` / `summarizeProgress()` / `markStatusUnavailable()` /
> `submitSolution()` / `apply()` / `loadUpstream()` 全部直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）—— 判 **🟡**

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是「规划」页既有拼题A 条目（`page-planning/src/index.js:534-548`）与既有 `ptaRead` 动作面（`campus/src/index.js:583`）。**本包不注册任何插槽、不新增页、不新建面板** |
| ② 功能相似且正交 | ✅ | 现有回答「哪些题集还没截止」（待办）；新增回答「这套题我做了几道、还差几道」。**同一个题集、同一次登录、同一个路由**，只是从「时间轴」换到「完成度轴」 |
| ③ 底层多调了更优质实现 | ⚠ **部分成立** | 上游确有本仓没有的东西（三态口径、提交链路、评测轮询），但**不可锁版、不可 import**（npm 404 + VS Code 扩展）→ 只能「借语义自写」。按 r65 的增益核算惯例，这一条只到 **🟡**，不到 🟢 |

> **为什么不判 🟢**：判 🟢 需要「底层真的调用了更优实现」。这里上游是个**不能装**的扩展，
> 最终写的是本仓自己的代码 —— 那部分和「自己写 60 行」没有区别。
> 之所以仍值得保留骨架，是因为 **F-1/F-2 是已存在的显示错误**（见下），修它们**不需要任何上游**；
> 上游的价值仅在于「把提交链路的协议事实一次性核对清楚」，避免第四次靠猜。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [jinzcdev/vscode-pintia](https://github.com/jinzcdev/vscode-pintia) |
| 版本 | `0.11.0`（`preview: true`），建仓 2022-04-19，push **2026-10-24** |
| 规模 | ★36 / fork 2 / 27,410 KB / TypeScript |
| npm | **不存在**：`registry.npmjs.org/vscode-pintia` → **HTTP 404 `{"error":"Not found"}`** → **不可锁版** |
| 许可证 | **MIT** ✅ —— 仓库根 `LICENSE` **1,073 B 全文读过**，`Copyright (c) 2022-present jinzcdev`，标准 MIT 正文，无附加限制；`package.json.license = "MIT"` 同口径（两处一致） |
| 作者 | Zhichao Jin（`jinzcdev`） |
| 形态 | **B 类**：VS Code 扩展（`engines.vscode ^1.66.0`，`main: ./out/extension`），**不是 DSH 插件**，无 `cordis.patch.yml`、无 `dsh.bundle.patch` |
| 首次发现 | 2026-10-26（r72 · B 组 · 「PTA 做题进度」轴） |

---

## 已核实的缺口（本轮读码 + 沙箱实跑）

复现环境：`pta.js` 可独立加载（`import()` 实测 OK），`Transport` 需 `tough-cookie@6.0.2` +
`@deepseek-ai/dsh-atomic-write@0.2.0-rc.2`（在**本仓之外**的临时目录装，未污染仓库）。
测法：注入一个假 `fetch`，按 URL 匹配回包 —— 与 `tests/campus.test.mjs` 的 `makeTransport` 同构。

```bash
grep -n "ptaRead\|case 'progress'" packages/dsh-zhiyun-source-campus/src/index.js   # → :583 ptaRead 动作面存在
grep -rn "pta=" packages/*/src --include=*.jsx                                      # → 前端 0 处调用 pta-read
grep -rn "/submissions" packages/dsh-zhiyun-source-campus/src/*.js                  # → 0 命中
```

### F-1 · `progress()` 把「未作答」算成了「做过」（实跑，零依赖，可当场改）

`pta.js:480 progress()` 的逻辑是「`problemStatus` 有几行就算几道、`PROBLEM_ACCEPTED` 才算过」，
其余状态一律进 `byStatus` 的杂项桶。喂四行（含一行缺字段）：

```text
输入: [ACCEPTED, WRONG_ANSWER, PROBLEM_NO_SUBMISSION, {无 problemSubmissionStatus}]
输出: {"total":4,"accepted":1,
       "byStatus":{"PROBLEM_ACCEPTED":1,"PROBLEM_WRONG_ANSWER":1,"PROBLEM_NO_SUBMISSION":1,"UNKNOWN":1}}
```

问题有两处，都是**口径**不是崩溃：

1. `total = 4` 用的是「状态行数」，而题集的真实题数是 `problem-summaries` 的合计（另一个端点）。
   两者**不一定相等** —— 本仓代码里没有任何地方核对过（`problemSet()` 会同时拿到两个，但没比）。
2. `PROBLEM_NO_SUBMISSION`（没交）与缺字段的 `UNKNOWN` 都**不是**做题记录，但都被算进 `total`；
   而上游把「缺行」直接视为未作答（`problemExamMapping.get(id) ?? PROBLEM_NO_ANSWER`）。

→ 若直接把这个 `accepted/total` 显示成「通过 1/4」，**分母是错的**，而且错法取决于平台返回多少行状态。
**这是本轮最该修的一条，且不需要上游、不需要提交链路。**

### F-2 · 状态端点失败时，「没读到」与「没做过」同形（实跑）

`problems()` 里 `exam-problem-status` 的调用被 `try/catch` 吞掉（`pta.js:381-387`，注释写
「匿名可读题集拿不到状态：留空，不当成'未做'」—— **意图是对的，实现不是**）。状态端点回 403：

```text
C progress  THREW FORBIDDEN（整条链路报错，规划页会显示"拼题A 读取失败"）
C problems  -> [["1",null],["2",null]]        ← 静默，且与"确实没作答"完全同形
D progress(空响应) -> null                    ← 又一态
```

三种情况（真未作答 / 没登录 / 端点 403）在返回值上是**三个不同的形状**（`null` 值 / `null` 整体 / 抛错），
但没有一个能表达「我读不到」。与 r67 F-3（fast 模式 403 整包清零）同族。

### F-3 · 做题进度数据层写好了，**没有任何消费方**（零调用）

`ptaRead` 的四个动作里，`problemSet` / `problems` / `problem` / `progress`：
`grep -rn "pta=" packages/*/src --include=*.jsx` → **0 处**前端调用。
界面只经过 `campus.todos()` → `problemSets` → `normalizePta()` 变成待办条目（`kind: 'problemSet'`）。

→ 这不是「缺实现」，是 r62「有单测零调用」/ r68「getter 无消费者」的**第四例**。
本包的判据①之所以成立，正是因为落点**必须**是既有列表行/既有路由，而不是新建页。

### F-4 · 提交链路在本仓**完全不存在**（写侧缺口）

```text
/api/exams/{id}/submissions        → 0 命中
/last-submissions                  → 0 命中
createProblemSetExam               → 0 命中
```

`pta.js` 文件头写着「⚠️ 只读：不提交代码、不创建提交记录」—— 这是**有意的边界**，不是遗漏。
所以「本地判题 / 一键提交」如果要做，是**新能力**，且必须先过伦理与合规这一关（见下）。

---

## 证据链：三处交叉核对（协议事实，不涉及代码复制）

| 事实 | vscode-pintia | pintia-problemset-toolkit | 本仓 |
| --- | --- | --- | --- |
| 题目详情键 | `json["problemSetProblem"]` ✅ | `detail_resp.get("problemSetProblem")` ✅ | `pta.js:435 row = data.problemSetProblem` ✅ |
| 题目列表键 | `problemSetProblems` | — | `pta.js:376` ✅ |
| 状态端点 | `/exam-problem-status` | 同，**另有** `/exams/{id}/problem-sets/{ps}/problem-status` | `/exam-problem-status` |
| 状态枚举 | `PROBLEM_ACCEPTED` / `PROBLEM_WRONG_ANSWER` / `PROBLEM_NO_ANSWER` | — | 只认 `PROBLEM_ACCEPTED`，其余进杂项 |
| Cookie 形态 | 可只输 `PTASession` 的值（会自动补前缀），再用 `/api/u/current` 验活 | — | 整串粘 + 种进 jar，**无验活** |
| 提交 | `POST /api/exams/{examID}/submissions` | 同 | — |

> 三个独立实现（TS / Python / 本仓）在**读侧**逐字一致 → 读侧协议可信。
> **写侧只有两个实现、且都在别人的账号上跑过** → 本仓若要做提交，必须先真机验证一次。

---

## 接入点（评审通过后的正确落点，均不在本骨架内）

| 步骤 | 落点 | 说明 |
| --- | --- | --- |
| ① | `campus/src/pta.js:480 progress()` | 改口径：分母取 `problem-summaries` 的合计，或明确改名 `statusRows`（TODO-1）。**零依赖，可先做** |
| ② | `campus/src/pta.js:381` 的 `catch` | 把「读不到」变成显式未知态（TODO-2），不要 `null` |
| ③ | `page-planning/src/client.jsx` 拼题A 条目行 | 在**既有行**上加「3/20 已通过」，点击时才 `ptaRead({action:'progress'})`（懒加载，避免首屏 +1 请求） |
| ④ | `campus/src/index.js` 服务面 | 提交链路要新增方法（`ptaSubmit`），**复用** `ptaTransport()` 与 200ms limiter，不另开 Agent |
| ⑤ | `packages/dsh-zhiyun-source-campus/package.json` | 本包**无依赖**；若要 vendor 上游 `src/utils`，走 TODO-5 单独评审 |

---

## 需要人工拍板的事

1. **TODO-0（阻塞 ③）**：进度数据在**哪个页面**出现？本包假定是「规划页」的拼题A 行。
   若产品要独立的「做题」页，则判据①不成立（变成新面板）→ **应直接驳回本骨架**。
2. **TODO-1（建议先做，与上游无关）**：`total` 的分母取哪个？三态还是四档？**这是显示口径，要产品定**。
3. **TODO-2**：状态端点失败时，是「整条不显示」还是「显示『读不到』」？本包主张后者。
4. **TODO-3（伦理边界，需明确写进产品文案）**：
   上游确实有完整提交能力，但 `qixuancao/pintiaskillmcp` 的 `safety-boundaries.md` 把界线写得很清楚：
   *No bypassing authentication, captchas, or rate limits. No exam cheating workflows.
   No unattended bulk submission.*
   → 本包主张：**只做「提交我自己写的代码」+「看评测结果」**，不做自动答题、不做批量代交、不做绕过限制。
   若评审认为连提交都不该做，则 TODO-3 直接删除，本包降为「纯读侧口径修复」—— 那也完全成立。
5. **TODO-4**：两套状态端点（`/exam-problem-status` vs `/exams/{id}/problem-sets/{ps}/problem-status`）
   是否等价？**本轮未核**（需真机账号）。

## 硬边界

- **不改上游源码**；本包 `dependencies` 为空，不 import 上游（它也装不上）。
- **不复制上游代码**：`src/` 里只有协议事实（端点字符串、状态枚举、轮询数值），没有一行 TS 实现。
- **不写 profile**；`Owner: shared`；包名带 `dsh-radar-` 前缀。
- **不新建面板**：落点是既有行、既有路由、既有服务。
- **不绕过任何平台限制**：不自动答题、不批量提交、不伪造评测。
