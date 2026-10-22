# dsh-radar-fsrs-scheduler

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-14 第二轮 · C 组）。采用前请**重写**并走正常包流程。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/open-spaced-repetition/ts-fsrs |
| npm | `ts-fsrs`（本骨架**锁版** `5.4.2`，不用 `^`） |
| 许可证 | MIT ✅（宽松白名单） |
| 语言 | TypeScript |
| ★ | 816（最近 push 2026-10-11，活跃） |

## 集成判定

- **类型**：B · 其他 JS 项目（非 DSH 原生插件包；无 `dsh.bundle.patch` 上游，故不含上游 DSH 依赖）
- **与现有功能的关系**：**强化式集成** —— 增强「学习」页（`dsh-zhiyun-page-study`）与「习题」能力（`dsh-zhiyun-core-quiz`）
- **为什么算强化而非重复**：三条同时成立 ——
  1. **仍是同一个面板**：「学习」页不新增页面、不改交互；
  2. **功能仍相似正交**：还是做题与复习，只是「先复习谁」由调度器决定；
  3. **底层多调了更优质实现**：把「手动/固定顺序刷题」的底层换成 FSRS 记忆模型调度。
- **集成方式**：锁版引入 npm 包 + 薄封装（能力提取 + 封装，不搬运上游源码）
- **边界**：`dsh-zhiyun-core-quiz` 继续只管出题与质检；本包只管「下一次该复习谁」；状态优先落 `dsh-zhiyun-core-study`，不自建落盘

## 上游未改动声明

本骨架**不含任何上游源码**，仅声明依赖并留下封装 TODO；FSRS 算法实现完全来自上游 `ts-fsrs`（MIT）。

## 尚未完成（采用前必做）

- [ ] 核实 `ts-fsrs` 5.4.2 的 API 表面，写薄封装（不重写算法）
- [ ] 与 `dsh-zhiyun-core-study` 对齐状态存放粒度（账号 + 课程 + 节次）
- [ ] 明确与 `dsh-zhiyun-core-quiz` 的接缝，避免职责互相侵入
- [ ] 补测试（`npm test`）、接入 profile、按 CONTRIBUTING 写 `OWNERS`
