# 归属说明

本候选骨架由 `dsh-ecosystem-radar` 生成，**未评审、未接入 profile、不可直接使用**。

## 锁版运行时依赖

- [`@ggboy123/dsh-paper-reader`](https://github.com/GGboya/dsh-paper-reader) · **MIT** · 版本 `1.3.1`
  （精确锁定，见 `src/upstream.js`）。**本包不新增这条依赖** —— 它在
  `packages/dsh-zhiyun-host-paper/` 里**已经**是运行时依赖，本包只是沿用同一版本号，
  以确保锚点层注入到与现有页面**同一个**上游渲染器上。

## 契约出处（仅字段名，未摘取任何代码）

- [`piggymon907/codex-paper-reader-skill`](https://github.com/piggymon907/codex-paper-reader-skill) · **MIT** ✅
  （`LICENSE` 1070 B 实文已核）· ★0 · tooling release `2.7.1`。

  **已阅读**：`README.md`、`paper-reader/SKILL.md`（边界与工作流）、
  `paper-reader/references/data-contract.md`（`Coordinates` / `Notes` / `Build identity` 三段）、
  `paper-reader/assets/reader/reader.js` 头部（`PAPER_READER_DATA` 消费方式、
  `markerLayer` / `pageCanvas` 等 DOM 句柄）、`scripts/bind_evidence.py` 头部、
  `scripts/build_reader.py` 头部，以及仓库全量文件清单（189 KB）。

  **用途**：作为「原文区块级证据锚点」的**坐标与字段契约**来源 —— PDF point 左上原点、
  多 `bboxes` 处理断裂行、`visual_bbox` 供裁切、`supports` / `does_not_support` /
  `limitations` 三字段、单一证据对象同时喂侧栏与全屏。

  **未摘取任何代码**：骨架内只有注释与 TODO，`src/` 下没有一行来自上游的函数体；
  `dependencies` 里也没有它（**它没有 npm 包，也没有 `package.json`** —— 是
  「Python 脚本 + 静态 HTML」的 Agent Skill，`requirements.txt` 仅 24 B）。
  字段名属接口，不属实现。

  ⚠ **只作能力提取，不可锁版挂载**：后端抽取是 Python（`extract_paper.py` 25.7 KB 等 9 个脚本），
  与本仓 Node 宿主不能共用。详见本包 README 的 R1。
