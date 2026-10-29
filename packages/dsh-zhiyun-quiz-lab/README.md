# 出题实验室（`dsh-zhiyun-quiz-lab`）

把 r4「按需求缓构建考法树与题模」注册成产品的一个**可挂载出题引擎**（`r4-lab`）。
纯宿主办，没有客户端半边，不新增页面、不改 `CLIENT_PACKAGES`。

## 三条边界

### 1. 它不是产品引擎

题目的 `reviewState:'ready'` 只代表**模型审核通过**，不代表题目合格。
报告里的 `psychometricValidation` 恒为 `{calibrated:false, difficulty:null, discrimination:null, studentMastery:null}`，
**不得据此宣称认知诊断**。没有学生作答数据之前，难度、区分度、掌握度都保持空值。

### 2. 卸载可逆，但痕迹不全可逆

关掉本包（「插件」页那一行）会：

- 引擎按钮从出题模式里消失；
- `engineVersionOf('r4-lab')` 回到 `null`，因此**新批次无法规划、旧断点无法续跑**；
- 已生成的题目**保留在题库里**，来源标注保持 `r4-lab`，
  `engineLabel` 会显示「已卸载的出题引擎：r4-lab」，而不是把它静默当成 r1。

最后一条是有意为之：把它回落成 r1 会让用户按 r1 的断点语义去续跑一份 r4 的断点。
那正是 `docs/architecture/quiz-bench-alignment.md` 批评过的「通用话术覆盖真实原因」。

### 3. `scripts/quiz_bench/experimental-r4` 是存档，不是副本源

内核已迁入本包 `src/kernel/`，**本包是唯一实现**。存档目录不搬走，因为
`compare.mjs` 的 `kernelHashes()` 把整目录算进实验冻结指纹并断言 `codeUnchanged` ——
它是被测量的对象。需要同步回存档时，先确认测量口径是否要一起变。

本仓禁止「同一件事两份实现」，所以存档只读、不再接收功能改动。

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | Cordis 半片：注册 / 注销引擎 |
| `src/engine.js` | 产品契约 ↔ r4 内核的适配层（唯一的实质复杂度所在） |
| `src/checkpoint.js` | 检查点版本与「拒绝恢复而不是尝试兼容」的边界 |
| `src/kernel/` | 迁入的 r4 内核（编译、调度、生成、题模） |
| `scripts/rewrite-imports.mjs` | 把内核里的跨包深引用改写成 core-quiz 的公开子路径 |
| `cordis.patch.yml` | 挂载入口 |

## 适配层为什么需要存在

`runR4(config)` 与 `generatePoints(input)` 有两处方向相反的错位，猜一个「差不多」的
对应关系会让恢复语义、进度统计和落库时机同时坏掉：

1. **入参**：产品用 `plan`（tasks / count / types / strategies），r4 用
   `pointIds / count / graph / state`。
2. **回调**：r4 **从不逐题回调**，它只回调整份检查点，跑完在
   `result.results[].questions` 里交卷；产品要求逐题 `onQuestion`。

所以适配层必须补发 `onQuestion`，而补发就必须能去重 —— 否则一次恢复会把同一批题
重复入库一次（这在实现时真实复现过）。

## 两个已知的旋钮

- `compositeCount` 默认 `0`：产品的 `plan` 只有 `ideaScope`，没有「几道综合题」，
  而 r4 有硬配额。不猜一个魔数。
- `maxCalls` 默认不设上限：产品没有调用预算概念，只靠 `signal` 中止。

## 检查点版本

`point-quiz-r4-lab-demand-v3` —— 这是**产品侧**「这份断点归谁解析」的号，
与内核内部的 `r4-demand-v3` 是两个层次。

它**不登记**在 `core-quiz/src/engines/versions.json`。那张表是
`measuredSha256` / `promotedSha256` 的证书表，只收被测量过的内核；
登记一个未测量的内核等于给它发证书，之后每次改结构都要走重测流程。

## 测试

```sh
node --test tests/quiz-lab-registry.test.mjs tests/quiz-lab-engine.test.mjs
```

注册表那组钉的是「没装 lab 的世界与今天逐字一致」，其中一条专门覆盖
`undefined === undefined` 那个曾经让任意断点都被判成可恢复的漏洞。
