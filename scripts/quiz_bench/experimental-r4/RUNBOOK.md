# r4 优化验证手册（一次实跑验四个改动）

> 2026-10-29 的实跑暴露了两条问题，之后又补了两条。这份手册的目的是：
> **一次付费实跑，同时验证四项改动是否生效**，而不是每改一处跑一次。

## 四项待验证的改动

| 改动 | 观察点 | 在数据里怎么看 |
|---|---|---|
| **P0-1** 审核缺陷结构化 | 返工时是否点名到具体选项 | `state.json` 里 ticket 的 `mustFix` 字段；`run.log` 无新的重复稿拒收 |
| **P0-2** 重复稿拦截 | 返工是否真的改过 | 不应再出现「与之前某一稿完全相同」以外的重复烧钱 |
| **P1-1** 盲解前置拦歧义 | 歧义是否在审核前被拦 | `stageBreakdown` 里 `r3-validate-instance` 调用数应低于上次 |
| **P1-2** 材料去重 | 第二轮 ideas 的输入 token | `stageBreakdown` 里 `r3-leaf-ideas` 的 `inputTokens` 应明显低于上次的 8558 |

## 为什么是 `batches: [2, 2]`

`batches` 是**每批题数的数组**，长度 = 批次数。所以 `[2,2]` 表示：

- 第 1 批（cold）出 2 题；
- 第 2 批（warm）再出 2 题，**复用第 1 批已编译的考法与题模**。

上次实跑用的是 `[2]`，只有 cold 一批，**r4 的缓构建复用优势一次都没被测到**——这是上次对比结论偏保守的直接原因。

## 开跑前（不花钱）

```powershell
cd <仓库根目录>

# 1) 资料 → 图谱（已有可跳过）
node scripts/quiz_bench/experimental-r4/prepare-real.mjs `
  scripts/knowledge_tree_bench/data/.logs/2026-10-23T16-36-02_87882-1973145.jsonl `
  artifacts/quiz-r4-real/prob-1-graph.json

# 2) 全量离线测试（74 条）
node tests/quiz-r4.test.mjs
node tests/quiz-r4-models.test.mjs
node tests/quiz-r4-comparison.test.mjs
node tests/quiz-lab-engine.test.mjs
node tests/quiz-lab-registry.test.mjs
```

期望：`7 / 24 / 17 / 17 / 9` 全绿。

## 实跑

```powershell
node scripts/quiz_bench/experimental-r4/compare.mjs `
  scripts/quiz_bench/experimental-r4/spec.verify.json `
  artifacts/quiz-r4-real/run-2
```

## 中断了怎么办

**加 `--resume` 重跑同一条，目录不要删、不要换：**

```powershell
node scripts/quiz_bench/experimental-r4/compare.mjs `
  scripts/quiz_bench/experimental-r4/spec.verify.json `
  artifacts/quiz-r4-real/run-2 --resume
```

已实测：抹掉批次产物只留 `state.json` 后续跑，**新增调用 0 次**。

## 跑完先看这四个数

```powershell
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('artifacts/quiz-r4-real/run-2/manifest.json','utf8'));console.table(m.runs.map(r=>({id:r.id,out:r.produced,calls:r.tokens.attempts,tok:r.tokens.totalTokens,err:r.error?.message?.slice(0,40)??null})))"
```

然后逐 run 看阶段归因（这是这次新加的）：

```powershell
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('artifacts/quiz-r4-real/run-2/manifest.json','utf8'));for(const r of m.runs){console.log('\n==',r.id,'produced',r.produced);console.table(r.stageBreakdown)}"
```

**与上次基线对照：**

| 阶段 | 上次实测 | 本次期望 | 归因 |
|---|---:|---|---|
| `r3-leaf-ideas` 输入 token（第2次） | 8558 | 明显下降 | 材料去重 |
| `r3-validate-instance` 调用数 | 5 | 下降 | 歧义在盲解阶段被拦 |
| `r3-instantiate` 调用数 | 4（含 3 次无效返工） | 下降 | 返工有方向 + 重复稿被拦 |
| warm 批次 `r3-leaf-ideas` 调用 | 未测到（上次只有 cold） | **0** | 编译缓存复用 |

> 补充已验证：`batches:[2,2]` 的 warm 批次在配置一致时 **ideas 调用为 0**（实测 5→4 次总调用，产出 1 题）。
> 注意 `maxPerFamily` 会进缓存键——改了它就不算同一批，这是有意为之，别误判成复用失效。

## 产物

```
artifacts/quiz-r4-real/run-2/
├── run.log              # 完整事件流水
├── manifest.json        # 汇总 + 每 run 的 stageBreakdown
├── questions.json
├── prob-1-*-cold.json   # cold 批次明细
├── prob-1-*-warm1.json  # warm 批次明细
└── prob-1-*-c1/         # 各臂 calls/attempts/stages/state/history
```

## 仍然要守住的边界

- **1 个知识点**：`compositeCount=0`，只出本地题，不构成综合题证据。
- **无学生作答**：难度/区分度/掌握度保持 `null`。
- **单次随机**：不做因果推断。
- `codeUnchanged` 为 false 时，这份数据不能当一次冻结对照。
