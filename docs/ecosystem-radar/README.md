# 生态雷达（radar）

本目录由「DSH 生态雷达」每日任务自动维护。

- `YYYY-MM-DD.md` —— 当日扫描报告
- `registry.md` —— 候选登记表（**追加式**，去重真值）

## `radar-` 前缀的包

`packages/dsh-radar-*` 是雷达自动生成的**候选骨架**：

- **未评审、未接入 profile、不可直接使用**；
- 仅供人工评估；真要采用须重写并走正常包流程；
- **不要**把它们写进 `profiles/zhiyun-bench/package.json` —— 未验证的包会让整个工作台起不来（CONTRIBUTING 3.1）。

## 评审入口

雷达会把结果推到 `radar` 分支并**自动开 PR**（radar → main）。请**在 PR 里审查**候选分级、许可证与集成判定。
