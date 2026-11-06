# ATTRIBUTION

本包为**候选骨架**，不含任何上游源码。仅以下列方式使用上游：

## ts-fsrs

- 仓库：https://github.com/open-spaced-repetition/ts-fsrs
- 版本：`5.4.2`（`dependencies` 中锁定精确版本，不用 `^`）
- 许可证：MIT — `Copyright (c) 2026 Open Spaced Repetition`
- 使用方式：**仅 `import` 公开导出**（`fsrs` / `createEmptyCard` / `Rating` / `generatorParameters`），
  通过 npm 依赖引入，**未复制、未改写、未内联**任何上游源码。
- 字段名引用：`card` 的 `due` / `stability` / `difficulty` / `elapsed_days` /
  `scheduled_days` / `learning_steps` / `reps` / `lapses` / `state` / `last_review`
  是上游公开数据结构，不构成对实现的复制。

## 与上游的语义偏差（有意为之）

- 关闭 `enable_fuzz`（上游默认开启），使同一输入可复现。
- `Again` 不做「立即到期」的补救 —— 保留上游 `state=3` + `due = 作答时刻 + 10min` 的原义。

## 本仓内的参考（非上游）

- `dsh-zhiyun-core-quiz/src/store.js` 的「FSRS 隔离」注释（`selfRecall` 唯一来源）
  是本包坚持「非法自评返回 `null`，绝不回落」的依据来源。**本包未复制其代码**，仅沿用该纪律。
