# 来源与改动说明

本包是**候选骨架**，由「生态雷达」生成，**未评审、未接入任何 profile**。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/RudrenduPaul/MasteryTrace |
| 包名 / 版本 | `masterytrace-cli@0.1.3`（npm 发布于 2026-09-25） |
| 许可证 | **MIT**（包内 `LICENSE` 实文：`MIT License` / `Copyright (c) 2026 Rudrendu Paul and Sourav Nandy`） |
| 作者 | Rudrendu Paul、Sourav Nandy |
| 发布物 | `dist/`（已编译 ESM + `.d.ts`），`files: ["dist","README.md","LICENSE"]` |

## 借鉴范围（CONTRIBUTING 3.3）

**已阅读**（仅阅读，未复制）：

- `package.json`（入口、依赖、`exports` 形状）
- `dist/models/bkt.d.ts`（`BktParams` 四参数语义、`BktSkillResult` 字段、`runForwardRecursion` 的用途注释）
- `dist/core/engine.d.ts`（`runScoring` 的入参/出参）
- `dist/core/event-schema.d.ts`（`ResponseEventSchema` 四字段、`EventValidationError`）
- `dist/models/bkt.js` 的**字段名层面**（`pInit` / `pTransit` / `pSlip` / `pGuess` / `priorL` 等标识符）
- `README.md` 与 `LICENSE`

**实跑**（不修改上游）：

```js
new BktModel().fit([false, false, false].map(...)).results[0].finalMastery   // → 0.062
```

**未借用 / 未复制**：

- 上游的递推公式实现、网格搜索实现、CLI、adapters、data 层；
- 上游任何源码文件都**没有**被复制进本仓库；
- 本包只通过 `dependencies` 锁版引用它（`masterytrace-cli: "0.1.3"`），**不改上游一行**。

**本目录的全部内容**均为占位与 TODO，`src/index.js` 的 `adapt()` 直接抛错。

> ⚠ 与 `CONTRIBUTING 3.3` 的对应：本包属于「**只做了简单借鉴（读接口、读类型、实跑验证）**」情形，
> 须在仓库根 `ATTRIBUTION.md` 的「已阅读源码/文档、拟在候选骨架中仅作能力提取」一节留痕。

## 若评审决定「只抄公式、不引依赖」

BKT 的前向递推是公开的教科书算法（Corbett & Anderson, 1995），
上游 `dist/models/bkt.d.ts` 也把 `runForwardRecursion` 的语义写在注释里
（返回每次作答后的 `P(L_t | obs)`）。若要零依赖自写，须由 OWNER 明确同意，
并在实现文件里写明公式出处 —— 届时本 `ATTRIBUTION.md` 应补充「改为独立实现，不再依赖上游包」。
